"use client";

import { useState } from "react";
import { FileDrop } from "@/components/FileDrop";
import { JoinPanel } from "@/components/JoinPanel";
import { ReceivedText } from "@/components/ReceivedText";
import { Sidebar } from "@/components/Sidebar";
import { TextShare } from "@/components/TextShare";
import { TransferCard } from "@/components/TransferCard";
import { useNotify } from "@/hooks/useNotify";
import { usePeerTransfer } from "@/hooks/usePeerTransfer";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import { useTheme } from "@/hooks/useTheme";

export default function Home() {
  const [error, setError] = useState("");
  const { dark, toggleTheme } = useTheme();
  const { toast, notify, enableNotifications } = useNotify();

  // The two hooks call into each other: the socket relays WebRTC signals to the peer connection,
  // and the peer connection sends its signals back out over the socket. The handlers below only
  // run after render, by which point `peer` is defined.
  const socket = useRoomSocket({
    onPeer: (connected) => peer.onPeer(connected),
    onSignal: (signal) => peer.handleSignal(signal),
    onText: () => notify("New text received"),
    onDisconnect: () => peer.close(),
    onLeave: () => peer.reset(),
    onError: setError,
  });
  const peer = usePeerTransfer({
    iceServers: socket.iceServers,
    sendSignal: socket.send,
    notify,
    onError: setError,
  });

  const { status, room, peerConnected } = socket;
  const busy = status === "connecting" || status === "reconnecting";

  const sendText = (text: string) => {
    if (!socket.send({ type: "text", text })) return false;
    notify("Text sent");
    return true;
  };

  return (
    <main className={`appShell ${dark ? "dark" : "light"}`}>
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
              <TextShare canSend={status === "connected"} onSend={sendText} onError={setError} />
              <div className="sectionLine">
                <span>FILE TRANSFER</span>
              </div>
              <FileDrop
                rtcReady={peer.rtcReady}
                rtcFailed={peer.rtcFailed}
                onFiles={peer.sendFiles}
              />
              {peer.transfer && <TransferCard transfer={peer.transfer} />}
              <ReceivedText text={socket.received} onError={setError} />
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
