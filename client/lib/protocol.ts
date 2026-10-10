// Messages exchanged with the realtime server (server/src/index.ts). Incoming data is untrusted JSON,
// so handlers still check the fields they use at runtime.

export type ErrorCode =
  | "BAD_JSON"
  | "BAD_ROOM"
  | "BAD_TEXT"
  | "NOT_IN_ROOM"
  | "RATE_LIMITED"
  | "ROOM_FULL"
  | "ROOM_NOT_FOUND"
  | "SERVER_BUSY"
  | "SERVER_ERROR"
  | "UNKNOWN_TYPE";

export type RtcSignal =
  | { type: "rtc-offer"; sdp: RTCSessionDescriptionInit }
  | { type: "rtc-answer"; sdp: RTCSessionDescriptionInit }
  | { type: "rtc-ice"; candidate: RTCIceCandidateInit };

export type ServerMessage =
  | { type: "created"; room: string; iceServers?: RTCIceServer[] }
  | {
      type: "joined";
      room: string;
      text: string;
      peerConnected: boolean;
      iceServers?: RTCIceServer[];
    }
  | { type: "peer"; connected: boolean }
  | { type: "text"; text: string }
  | { type: "error"; code: ErrorCode; message: string }
  | RtcSignal;

export type RoomAction = { type: "create" } | { type: "join"; room: string };

export type ClientMessage = RoomAction | { type: "text"; text: string } | RtcSignal;

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";
export const MAX_TEXT_LENGTH = 50_000;
