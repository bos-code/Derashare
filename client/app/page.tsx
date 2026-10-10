"use client";

import { useEffect, useRef, useState } from "react";
import { FileDrop } from "@/components/FileDrop";
import { InviteCard } from "@/components/InviteCard";
import { JoinPanel } from "@/components/JoinPanel";
import { ReceivedText } from "@/components/ReceivedText";
import { Sidebar } from "@/components/Sidebar";
import { TextHistory } from "@/components/TextHistory";
import { TextShare } from "@/components/TextShare";
import { TransferList } from "@/components/TransferList";
import { useNotify } from "@/hooks/useNotify";
import { usePeerTransfer } from "@/hooks/usePeerTransfer";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import { useTextHistory } from "@/hooks/useTextHistory";
import { useTheme } from "@/hooks/useTheme";
import { MAX_TEXT_LENGTH } from "@/lib/protocol";

export default function Home() {
  const [error, setError] = useState("");
  // Text handed over by the OS share sheet (manifest share_target), waiting to be sent.
  const [sharedText, setSharedText] = useState("");
  const { dark, toggleTheme } = useTheme();
  const { toast, notify, enableNotifications } = useNotify();
  const history = useTextHistory();

  // The two hooks call into each other: the socket relays WebRTC signals to the peer connection,
  // and the peer connection sends its signals back out over the socket. The handlers below only
  // run after render, by which point `peer` is defined.
  const socket = useRoomSocket({
    onPeer: (connected) => peer.onPeer(connected),
    onSignal: (signal) => peer.handleSignal(signal),
    onText: (text) => {
      history.add("received", text);
      notify("New text received");
    },
    onDisconnect: () => peer.close(),
    onLeave: () => {
      peer.reset();
      history.clear();
    },
    onError: setError,
  });
  const peer = usePeerTransfer({
    iceServers: socket.iceServers,
    sendSignal: socket.send,
    notify,
    onError: setError,
  });

  const { status, room, peerConnected } = socket;

  // Opening a join link (/?room=123456, e.g. from the QR code) joins that room straight away.
  // Text shared from another app via the OS share sheet (?title=&text=&url=) is put in the draft.
  const autoJoined = useRef(false);
  const joinRoom = socket.join;
  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    const params = new URLSearchParams(window.location.search);
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean)
      .join("\n");
    if (shared) setSharedText(shared.slice(0, MAX_TEXT_LENGTH));
    const code = params.get("room");
    for (const key of ["room", "title", "text", "url"]) params.delete(key);
    const query = params.toString();
    if (shared || code)
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    if (!code) return;
    if (/^\d{6}$/.test(code)) joinRoom(code);
    else setError("That join link is invalid. Enter the 6-digit room code instead.");
  }, [joinRoom]);
  const busy = status === "connecting" || status === "reconnecting";

  const sendText = (text: string) => {
    if (!socket.send({ type: "text", text })) return false;
    history.add("sent", text);
    setSharedText("");
    notify("Text sent");
    return true;
  };

  return (
    <main className="appShell">
      <Sidebar
        status={status}
        room={room}
        peerConnected={peerConnected}
        rtcReady={peer.rtcReady}
        rtcFailed={peer.rtcFailed}
        dark={dark}
        onToggleTheme={toggleTheme}
        onEnableNotifications={enableNotifications}
        onLeave={socket.leave}
      />
      <section className="content">
        <div className="contentBox">
          <header>
            <div>
              <h1>{room ? "Share" : "Connect your devices"}</h1>
              <p>
                {room
                  ? "Send text or any file directly to the connected device."
                  : "Create a temporary room or join one from another device."}
              </p>
            </div>
          </header>
          {!room ? (
            <JoinPanel
              status={status}
              busy={busy}
              onCreate={socket.create}
              onJoin={socket.join}
              onError={setError}
            />
          ) : (
            <div className="workspace">
              <div className="mobileRoom">
                <span className={`dot ${status}`} />
                <strong>
                  {peerConnected
                    ? peer.rtcReady
                      ? "Device linked · Files ready"
                      : peer.rtcFailed
                        ? "Device linked · Files unavailable"
                        : "Device linked · Preparing files…"
                    : "Waiting for other device"}
                </strong>
                <span>{room}</span>
              </div>
              {!peerConnected && <InviteCard room={room} onError={setError} />}
              <TextShare
                initialDraft={sharedText}
                canSend={status === "connected"}
                onSend={sendText}
                onError={setError}
              />
              <div className="sectionLine">
                <span>FILE TRANSFER</span>
              </div>
              <FileDrop
                rtcReady={peer.rtcReady}
                rtcFailed={peer.rtcFailed}
                onFiles={peer.sendFiles}
              />
              <TransferList transfers={peer.transfers} onClear={peer.clearTransfers} />
              <ReceivedText text={socket.received} onError={setError} />
              <TextHistory entries={history.entries} onError={setError} />
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {toast && <div className="toast">{toast}</div>}
        </div>
      </section>
    </main>
  );
}
