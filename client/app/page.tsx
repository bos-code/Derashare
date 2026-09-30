"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "connected" | "reconnecting" | "offline";
type ServerMessage =
  | { type: "created"; room: string }
  | { type: "joined"; room: string; text?: string; peerConnected?: boolean }
  | { type: "peer"; connected: boolean }
  | { type: "text"; text: string }
  | { type: "error"; code: string; message: string };

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [room, setRoom] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [draft, setDraft] = useState("");
  const [received, setReceived] = useState("");
  const [peerConnected, setPeerConnected] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const desiredAction = useRef<{ type: "create" | "join"; room?: string } | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalClose = useRef(false);

  const connect = useCallback((action: { type: "create" | "join"; room?: string }, reconnect = false) => {
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) socketRef.current.close();
    desiredAction.current = action;
    intentionalClose.current = false;
    setError("");
    setStatus(reconnect ? "reconnecting" : "connecting");
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => socket.send(JSON.stringify(action));
    socket.onmessage = (event) => {
      let data: ServerMessage;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === "created") {
        setRoom(data.room); setRoomInput(data.room); setStatus("connected");
        desiredAction.current = { type: "join", room: data.room };
      } else if (data.type === "joined") {
        setRoom(data.room); setRoomInput(data.room); setStatus("connected");
        setPeerConnected(Boolean(data.peerConnected));
        if (typeof data.text === "string") setReceived(data.text);
        desiredAction.current = { type: "join", room: data.room };
      } else if (data.type === "peer") {
        setPeerConnected(data.connected);
      } else if (data.type === "text") {
        setReceived(data.text);
      } else if (data.type === "error") {
        setError(data.message); setStatus("idle"); intentionalClose.current = true; socket.close();
      }
    };
    socket.onclose = () => {
      if (intentionalClose.current) return;
      setPeerConnected(false);
      if (desiredAction.current?.room) {
        setStatus("reconnecting");
        reconnectTimer.current = setTimeout(() => connect(desiredAction.current!, true), 1800);
      } else setStatus("offline");
    };
    socket.onerror = () => setError("Could not reach the Dera Share server.");
  }, []);

  useEffect(() => () => {
    intentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    socketRef.current?.close();
  }, []);

  function createRoom() { connect({ type: "create" }); }
  function joinRoom() {
    const code = roomInput.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) { setError("Enter a 6-digit room code."); return; }
    connect({ type: "join", room: code });
  }
  function sendText() {
    if (!draft.trim() || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "text", text: draft }));
    setDraft("");
  }
  async function paste() {
    try { setDraft(await navigator.clipboard.readText()); }
    catch { setError("Clipboard permission was blocked. Paste into the box manually."); }
  }
  async function copy() {
    if (!received) return;
    try { await navigator.clipboard.writeText(received); setCopied(true); setTimeout(() => setCopied(false), 1200); }
    catch { setError("Could not copy automatically. Select the text and copy it manually."); }
  }
  function leave() {
    intentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    socketRef.current?.close(); socketRef.current = null; desiredAction.current = null;
    setRoom(""); setRoomInput(""); setReceived(""); setPeerConnected(false); setStatus("idle"); setError("");
  }

  const active = Boolean(room);
  return (
    <main className="shell">
      <section className="card">
        <header><div className="mark">D</div><div><h1>Dera Share</h1><p>Move text between two devices. Nothing is permanently stored.</p></div></header>

        {!active ? (
          <div className="setup">
            <button className="primary big" onClick={createRoom} disabled={status === "connecting"}>{status === "connecting" ? "Connecting…" : "Create a room"}</button>
            <div className="divider"><span>or join an existing room</span></div>
            <label>6-digit room code</label>
            <div className="joinRow">
              <input className="codeInput" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={roomInput} onChange={(e) => setRoomInput(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && joinRoom()} placeholder="000000" />
              <button className="secondary" onClick={joinRoom}>Join</button>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="roomBar"><div><span className={`dot ${status}`}></span><strong>{status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</strong><small>{peerConnected ? "Other device is here" : "Waiting for the other device"}</small></div><button className="leave" onClick={leave}>Leave</button></div>
            <div className="roomCode"><span>Room code</span><strong>{room}</strong><button onClick={() => navigator.clipboard.writeText(room)}>Copy code</button></div>
            <label>Send text</label>
            <div className="editor"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste or type something…" maxLength={50000} /><div className="editorActions"><button onClick={paste}>Paste</button><span>{draft.length.toLocaleString()} / 50,000</span></div></div>
            <button className="primary send" disabled={!draft.trim() || status !== "connected"} onClick={sendText}>Send to other device</button>
            <div className="receivedHead"><label>Received</label><span>{received ? "Latest text" : "Nothing received yet"}</span></div>
            <div className={`received ${!received ? "empty" : ""}`}><pre>{received || "Text sent from the other device will appear here."}</pre>{received && <button className="copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>}</div>
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <footer>Rooms are temporary · Maximum 2 devices</footer>
      </section>
    </main>
  );
}
