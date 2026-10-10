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

// Used until the server sends its own list (which may include TURN relays).
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];
// How long to wait for the data channel to open before telling the user it isn't going to.
const CONNECT_TIMEOUT_MS = 20_000;
// Pause sending while this much data is queued in the data channel.
const MAX_BUFFERED = 4 * 1024 * 1024;
// Transfers kept in the list; older ones are dropped and their blob URLs released.
const MAX_TRANSFERS = 20;

// A counter rather than crypto.randomUUID(), which doesn't exist on plain-http LAN addresses.
let transferCounter = 0;
const nextTransferId = () => `t${++transferCounter}`;

type Incoming = {
  id?: string;
  meta?: { name: string; size: number; fileType: string };
  chunks: ArrayBuffer[];
  received: number;
};

type Options = {
  iceServers: RTCIceServer[] | null;
  sendSignal: (message: ClientMessage) => void;
  notify: (message: string) => void;
  onError: (message: string) => void;
};

// WebRTC data channel used to send files directly between the two devices. The device that sees the
// other one arrive makes the offer; signalling goes through the realtime server.
export function usePeerTransfer({ iceServers, sendSignal, notify, onError }: Options) {
  const [rtcReady, setRtcReady] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  // The peer is present but a direct (or relayed) connection could not be established.
  const [rtcFailed, setRtcFailed] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const incoming = useRef<Incoming>({ chunks: [], received: 0 });
  const sendChain = useRef<Promise<void>>(Promise.resolve());
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef({ iceServers, sendSignal, notify, onError });
  optionsRef.current = { iceServers, sendSignal, notify, onError };
  const urls = useRef(new Set<string>());

  // Newest first. Blob URLs of transfers that fall off the end are revoked.
  const addTransfer = useCallback((transfer: Transfer) => {
    setTransfers((list) => {
      const next = [transfer, ...list];
      for (const old of next.slice(MAX_TRANSFERS))
        if (old.url) {
          URL.revokeObjectURL(old.url);
          urls.current.delete(old.url);
        }
      return next.slice(0, MAX_TRANSFERS);
    });
  }, []);
  const updateTransfer = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);
  const clearTransfers = useCallback(() => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setTransfers([]);
  }, []);

  const clearConnectTimer = useCallback(() => {
    if (connectTimer.current) clearTimeout(connectTimer.current);
    connectTimer.current = null;
  }, []);
  const armConnectTimer = useCallback(() => {
    clearConnectTimer();
    setRtcFailed(false);
    connectTimer.current = setTimeout(() => {
      if (channelRef.current?.readyState === "open") return;
      setRtcFailed(true);
      optionsRef.current.onError(
        "Couldn't open a direct connection to the other device, so file sharing is unavailable. Text still works. Try both devices on the same Wi-Fi, or leave and rejoin.",
      );
    }, CONNECT_TIMEOUT_MS);
  }, [clearConnectTimer]);

  const handleChannelMessage = useCallback(
    (e: MessageEvent) => {
      const { notify, onError } = optionsRef.current;
      const fail = (message: string) => {
        const { id } = incoming.current;
        if (id) updateTransfer(id, { status: "failed" });
        incoming.current = { chunks: [], received: 0 };
        onError(message);
      };

      if (typeof e.data !== "string") {
        const i = incoming.current;
        if (!i.meta || !i.id) return;
        if (i.received + e.data.byteLength > i.meta.size) {
          fail(`${i.meta.name} was larger than announced and was discarded.`);
          return;
        }
        i.chunks.push(e.data);
        i.received += e.data.byteLength;
        updateTransfer(i.id, {
          progress: Math.min(99, Math.round((i.received / Math.max(1, i.meta.size)) * 100)),
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
        // A new file while one is still arriving means the sender gave up on the previous one.
        if (incoming.current.id) updateTransfer(incoming.current.id, { status: "failed" });
        const id = nextTransferId();
        incoming.current = { id, meta: { name, size, fileType }, chunks: [], received: 0 };
        addTransfer({
          id,
          status: "active",
          name,
          size,
          progress: 0,
          direction: "receive",
          type: fileType,
        });
      }

      if (msg?.kind === "file-end") {
        const i = incoming.current;
        if (!i.meta || !i.id) return;
        if (i.received !== i.meta.size) {
          fail(`${i.meta.name} arrived incomplete. Ask the sender to try again.`);
          return;
        }
        const url = URL.createObjectURL(new Blob(i.chunks, { type: i.meta.fileType }));
        urls.current.add(url);
        updateTransfer(i.id, { status: "done", progress: 100, url });
        incoming.current = { chunks: [], received: 0 };
        notify(`${i.meta.name} received`);
      }
    },
    [addTransfer, updateTransfer],
  );

  const bindChannel = useCallback(
    (ch: RTCDataChannel) => {
      channelRef.current = ch;
      ch.binaryType = "arraybuffer";
      ch.onopen = () => {
        clearConnectTimer();
        setRtcFailed(false);
        setRtcReady(true);
        optionsRef.current.onError("");
      };
      ch.onclose = () => setRtcReady(false);
      ch.onmessage = handleChannelMessage;
    },
    [clearConnectTimer, handleChannelMessage],
  );

  const makePeer = useCallback(() => {
    pcRef.current?.close();
    pendingIce.current = [];
    const pc = new RTCPeerConnection({
      iceServers: optionsRef.current.iceServers ?? FALLBACK_ICE_SERVERS,
    });
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
      armConnectTimer();
      const pc = makePeer();
      bindChannel(pc.createDataChannel("files", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      optionsRef.current.sendSignal({ type: "rtc-offer", sdp: offer });
    } catch {
      optionsRef.current.onError("Could not prepare peer-to-peer file sharing.");
    }
  }, [armConnectTimer, bindChannel, makePeer]);

  const close = useCallback(() => {
    clearConnectTimer();
    setRtcFailed(false);
    setRtcReady(false);
    pcRef.current?.close();
  }, [clearConnectTimer]);

  const reset = useCallback(() => {
    close();
    incoming.current = { chunks: [], received: 0 };
    clearTransfers();
  }, [clearTransfers, close]);

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
          armConnectTimer();
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
    [armConnectTimer, makePeer],
  );

  const sendOne = useCallback(
    async (file: File, id: string) => {
      const { notify, onError } = optionsRef.current;
      const ch = channelRef.current;
      if (!ch || ch.readyState !== "open") {
        updateTransfer(id, { status: "failed" });
        onError("File transfer is not ready yet. Wait until Files ready appears.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        updateTransfer(id, { status: "failed" });
        onError(`${file.name} is larger than the 500 MB limit.`);
        return;
      }
      onError("");
      updateTransfer(id, { status: "active" });
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
          updateTransfer(id, { progress: Math.round((offset / file.size) * 100) });
        }
        const end: FileEnd = { kind: "file-end" };
        ch.send(JSON.stringify(end));
        updateTransfer(id, { status: "done", progress: 100 });
        notify(`${file.name} sent`);
      } catch {
        updateTransfer(id, { status: "failed" });
        onError(`Sending ${file.name} was interrupted. Reconnect and try again.`);
      }
    },
    [updateTransfer],
  );

  // Files are sent one at a time so their chunks can't interleave on the channel.
  const sendFiles = useCallback(
    (files: FileList | null | undefined) => {
      for (const file of Array.from(files || [])) {
        const id = nextTransferId();
        addTransfer({
          id,
          status: "queued",
          name: file.name,
          size: file.size,
          progress: 0,
          direction: "send",
          type: file.type,
        });
        sendChain.current = sendChain.current.then(() => sendOne(file, id));
      }
    },
    [addTransfer, sendOne],
  );

  useEffect(
    () => () => {
      clearConnectTimer();
      pcRef.current?.close();
    },
    [clearConnectTimer],
  );
  useEffect(() => {
    const live = urls.current;
    return () => {
      for (const url of live) URL.revokeObjectURL(url);
    };
  }, []);

  return {
    rtcReady,
    rtcFailed,
    transfers,
    clearTransfers,
    sendFiles,
    onPeer,
    handleSignal,
    close,
    reset,
  };
}
