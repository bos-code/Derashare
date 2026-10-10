import { useCallback, useEffect, useRef, useState } from "react";
import {
  WS_URL,
  type ClientMessage,
  type RoomAction,
  type RtcSignal,
  type ServerMessage,
} from "@/lib/protocol";

export type Status = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

// ROOM_FULL during a reconnect usually means the server hasn't yet dropped this device's old socket,
// so retry a few times before giving up.
const MAX_RECONNECT_FULL = 6;
const MAX_RECONNECT_DELAY_MS = 30_000;

export type RoomSocketHandlers = {
  onPeer: (connected: boolean) => void;
  onSignal: (signal: RtcSignal) => void;
  onText: () => void;
  // The socket dropped: tear down the peer connection (a reconnect will negotiate a new one).
  onDisconnect: () => void;
  // The room was left or rejected: also clear any per-room state such as the last transfer.
  onLeave: () => void;
  onError: (message: string) => void;
};

export function useRoomSocket(handlers: RoomSocketHandlers) {
  const [status, setStatus] = useState<Status>("idle");
  const [room, setRoom] = useState("");
  const [peerConnected, setPeerConnected] = useState(false);
  const [received, setReceived] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const desiredAction = useRef<RoomAction | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const intentionalClose = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const resetRoom = useCallback(() => {
    desiredAction.current = null;
    reconnectAttempts.current = 0;
    setRoom("");
    setReceived("");
    setPeerConnected(false);
    setStatus("idle");
    handlersRef.current.onLeave();
  }, []);

  const connect = useCallback(
    (action: RoomAction, reconnect = false) => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      // Detach the previous socket first so its late close event can't schedule a reconnect.
      const old = socketRef.current;
      if (old) {
        old.onopen = old.onmessage = old.onclose = old.onerror = null;
        if (old.readyState <= WebSocket.OPEN) old.close();
      }
      desiredAction.current = action;
      intentionalClose.current = false;
      handlersRef.current.onError("");
      setStatus(reconnect ? "reconnecting" : "connecting");

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify(action));

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        let data: ServerMessage;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        const h = handlersRef.current;
        if (data.type === "created" && data.room) {
          reconnectAttempts.current = 0;
          setRoom(data.room);
          setStatus("connected");
          desiredAction.current = { type: "join", room: data.room };
        } else if (data.type === "joined" && data.room) {
          reconnectAttempts.current = 0;
          setRoom(data.room);
          setStatus("connected");
          setPeerConnected(Boolean(data.peerConnected));
          if (data.text) setReceived(data.text);
          desiredAction.current = { type: "join", room: data.room };
        } else if (data.type === "peer") {
          setPeerConnected(Boolean(data.connected));
          h.onPeer(Boolean(data.connected));
        } else if (data.type === "text" && typeof data.text === "string") {
          setReceived(data.text);
          h.onText();
        } else if ((data.type === "rtc-offer" || data.type === "rtc-answer") && data.sdp) {
          h.onSignal(data);
        } else if (data.type === "rtc-ice" && data.candidate) {
          h.onSignal(data);
        } else if (data.type === "error") {
          if (
            data.code === "ROOM_FULL" &&
            reconnectAttempts.current > 0 &&
            reconnectAttempts.current < MAX_RECONNECT_FULL
          ) {
            socket.close();
            return;
          }
          h.onError(data.message || "Something went wrong.");
          if (
            data.code === "ROOM_FULL" ||
            data.code === "ROOM_NOT_FOUND" ||
            data.code === "BAD_ROOM"
          ) {
            intentionalClose.current = true;
            socket.close();
            resetRoom();
          }
        }
      };

      socket.onclose = () => {
        if (socketRef.current !== socket || intentionalClose.current) return;
        setPeerConnected(false);
        handlersRef.current.onDisconnect();
        const next = desiredAction.current;
        if (next?.type === "join") {
          setStatus("reconnecting");
          const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** reconnectAttempts.current++);
          reconnectTimer.current = setTimeout(() => connect(next, true), delay);
        } else setStatus("offline");
      };

      socket.onerror = () => {
        if (socketRef.current === socket)
          handlersRef.current.onError("Could not reach the Dera Share server.");
      };
    },
    [resetRoom],
  );

  const leave = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    socketRef.current?.close();
    socketRef.current = null;
    resetRoom();
    handlersRef.current.onError("");
  }, [resetRoom]);

  useEffect(
    () => () => {
      intentionalClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
    },
    [],
  );

  return {
    status,
    room,
    peerConnected,
    received,
    create: () => connect({ type: "create" }),
    join: (code: string) => connect({ type: "join", room: code }),
    leave,
    send,
  };
}
