import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHUNK_SIZE,
  MAX_FILE_SIZE,
  safeFileType,
  type FileEnd,
  type FileMeta,
  type Transfer,
} from "@/lib/files";
import type { ClientMessage, RtcSignal } from "@/lib/protocol";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
// Pause sending while this much data is queued in the data channel.
const MAX_BUFFERED = 4 * 1024 * 1024;

type Incoming = {
  meta?: { name: string; size: number; fileType: string };
  chunks: ArrayBuffer[];
  received: number;
};

type Options = {
  sendSignal: (message: ClientMessage) => void;
  notify: (message: string) => void;
  onError: (message: string) => void;
};

// WebRTC data channel used to send files directly between the two devices. The device that sees the
// other one arrive makes the offer; signalling goes through the realtime server.
export function usePeerTransfer({ sendSignal, notify, onError }: Options) {
  const [rtcReady, setRtcReady] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const incoming = useRef<Incoming>({ chunks: [], received: 0 });
  const sendChain = useRef<Promise<void>>(Promise.resolve());
  const optionsRef = useRef({ sendSignal, notify, onError });
  optionsRef.current = { sendSignal, notify, onError };

  const handleChannelMessage = useCallback((e: MessageEvent) => {
    const { notify, onError } = optionsRef.current;
    const fail = (message: string) => {
      incoming.current = { chunks: [], received: 0 };
      setTransfer(null);
      onError(message);
    };

    if (typeof e.data !== "string") {
      const i = incoming.current;
      if (!i.meta) return;
      if (i.received + e.data.byteLength > i.meta.size) {
        fail(`${i.meta.name} was larger than announced and was discarded.`);
        return;
      }
      i.chunks.push(e.data);
      i.received += e.data.byteLength;
      setTransfer({
        name: i.meta.name,
        size: i.meta.size,
        progress: Math.min(99, Math.round((i.received / Math.max(1, i.meta.size)) * 100)),
        direction: "receive",
        type: i.meta.fileType,
      });
      return;
    }

    let msg: Partial<FileMeta> | Partial<FileEnd> | null;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    if (msg?.kind === "file-meta") {
      const size = Number(msg.size);
      if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_SIZE) {
        fail("An incoming file was rejected because it is larger than 500 MB.");
        return;
      }
      const name = (typeof msg.name === "string" && msg.name.trim() ? msg.name : "file").slice(
        0,
        255,
      );
      const fileType = safeFileType(name, msg.fileType);
      incoming.current = { meta: { name, size, fileType }, chunks: [], received: 0 };
      setTransfer({ name, size, progress: 0, direction: "receive", type: fileType });
    }

    if (msg?.kind === "file-end") {
      const i = incoming.current;
      if (!i.meta) return;
      if (i.received !== i.meta.size) {
        fail(`${i.meta.name} arrived incomplete. Ask the sender to try again.`);
        return;
      }
      const url = URL.createObjectURL(new Blob(i.chunks, { type: i.meta.fileType }));
      incoming.current = { chunks: [], received: 0 };
      setTransfer({
        name: i.meta.name,
        size: i.meta.size,
        progress: 100,
        direction: "receive",
        url,
        type: i.meta.fileType,
      });
      notify(`${i.meta.name} received`);
    }
  }, []);

  const bindChannel = useCallback(
    (ch: RTCDataChannel) => {
      channelRef.current = ch;
      ch.binaryType = "arraybuffer";
      ch.onopen = () => {
        setRtcReady(true);
        optionsRef.current.onError("");
      };
      ch.onclose = () => setRtcReady(false);
      ch.onmessage = handleChannelMessage;
    },
    [handleChannelMessage],
  );

  const makePeer = useCallback(() => {
    pcRef.current?.close();
    pendingIce.current = [];
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate)
        optionsRef.current.sendSignal({ type: "rtc-ice", candidate: e.candidate.toJSON() });
    };
    pc.ondatachannel = (e) => bindChannel(e.channel);
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) setRtcReady(false);
    };
    return pc;
  }, [bindChannel]);

  const flushIce = async (pc: RTCPeerConnection) => {
    for (const candidate of pendingIce.current.splice(0)) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {}
    }
  };

  const startOffer = useCallback(async () => {
    try {
      const pc = makePeer();
      bindChannel(pc.createDataChannel("files", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      optionsRef.current.sendSignal({ type: "rtc-offer", sdp: offer });
    } catch {
      optionsRef.current.onError("Could not prepare peer-to-peer file sharing.");
    }
  }, [bindChannel, makePeer]);

  const close = useCallback(() => {
    setRtcReady(false);
    pcRef.current?.close();
  }, []);

  const reset = useCallback(() => {
    close();
    setTransfer(null);
  }, [close]);

  const onPeer = useCallback(
    (connected: boolean) => {
      if (connected) setTimeout(() => startOffer(), 250);
      else close();
    },
    [close, startOffer],
  );

  const handleSignal = useCallback(
    async (signal: RtcSignal) => {
      const { sendSignal, onError } = optionsRef.current;
      if (signal.type === "rtc-offer") {
        try {
          const pc = makePeer();
          await pc.setRemoteDescription(signal.sdp);
          await flushIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "rtc-answer", sdp: answer });
        } catch {
          onError("File connection negotiation failed. Rejoin and try again.");
        }
      } else if (signal.type === "rtc-answer") {
        const pc = pcRef.current;
        if (!pc) return;
        try {
          await pc.setRemoteDescription(signal.sdp);
          await flushIce(pc);
        } catch {
          onError("File connection negotiation failed.");
        }
      } else {
        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) pendingIce.current.push(signal.candidate);
        else {
          try {
            await pc.addIceCandidate(signal.candidate);
          } catch {}
        }
      }
    },
    [makePeer],
  );

  const sendOne = useCallback(async (file: File) => {
    const { notify, onError } = optionsRef.current;
    const ch = channelRef.current;
    if (!ch || ch.readyState !== "open") {
      onError("File transfer is not ready yet. Wait until Files ready appears.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      onError(`${file.name} is larger than the 500 MB limit.`);
      return;
    }
    onError("");
    const progress = (sent: number) =>
      setTransfer({
        name: file.name,
        size: file.size,
        progress: file.size ? Math.round((sent / file.size) * 100) : 0,
        direction: "send",
        type: file.type,
      });
    progress(0);
    try {
      const meta: FileMeta = {
        kind: "file-meta",
        name: file.name,
        size: file.size,
        fileType: file.type,
      };
      ch.send(JSON.stringify(meta));
      let offset = 0;
      while (offset < file.size) {
        while (ch.bufferedAmount > MAX_BUFFERED) {
          if (ch.readyState !== "open") throw new Error("Data channel closed");
          await new Promise((r) => setTimeout(r, 40));
        }
        const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        ch.send(buf);
        offset += buf.byteLength;
        progress(offset);
      }
      const end: FileEnd = { kind: "file-end" };
      ch.send(JSON.stringify(end));
      notify(`${file.name} sent`);
    } catch {
      setTransfer(null);
      onError(`Sending ${file.name} was interrupted. Reconnect and try again.`);
    }
  }, []);

  // Files are sent one at a time so their chunks can't interleave on the channel.
  const sendFiles = useCallback(
    (files: FileList | null | undefined) => {
      for (const file of Array.from(files || []))
        sendChain.current = sendChain.current.then(() => sendOne(file));
    },
    [sendOne],
  );

  useEffect(() => () => pcRef.current?.close(), []);
  useEffect(
    () => () => {
      if (transfer?.url) URL.revokeObjectURL(transfer.url);
    },
    [transfer?.url],
  );

  return { rtcReady, transfer, sendFiles, onPeer, handleSignal, close, reset };
}
