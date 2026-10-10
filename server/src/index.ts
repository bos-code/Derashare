import { createServer, type IncomingMessage } from "node:http";
import { randomInt } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8080);
const MAX_TEXT_LENGTH = 50_000;
const ROOM_GRACE_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 25_000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 10_000);
// Room create/join attempts allowed per IP per window. Makes guessing 6-digit codes impractical.
const ROOM_ATTEMPTS_PER_WINDOW = 15;
const ROOM_ATTEMPT_WINDOW_MS = 60_000;
// Any message type, per connection. Generous enough for WebRTC ICE bursts.
const MESSAGES_PER_WINDOW = 300;
const MESSAGE_WINDOW_MS = 10_000;
// Comma-separated list such as "https://derashare.vercel.app". Unset allows any origin (local development).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
// Behind a reverse proxy (Render, Railway) the client IP is in x-forwarded-for.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

type Client = WebSocket & {
  room?: string;
  alive?: boolean;
  ip?: string;
  messageCount?: number;
  messageWindowStart?: number;
};
type Room = { clients: Set<Client>; latestText: string; cleanup?: NodeJS.Timeout };
const rooms = new Map<string, Room>();

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Dera Share realtime server");
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 128 * 1024,
  verifyClient: ({ origin }: { origin: string }) =>
    ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin),
});

const roomAttempts = new Map<string, { count: number; windowStart: number }>();
function allowRoomAttempt(ip: string) {
  const now = Date.now();
  const entry = roomAttempts.get(ip);
  if (!entry || now - entry.windowStart >= ROOM_ATTEMPT_WINDOW_MS) {
    roomAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= ROOM_ATTEMPTS_PER_WINDOW;
}
function allowMessage(ws: Client) {
  const now = Date.now();
  if (!ws.messageWindowStart || now - ws.messageWindowStart >= MESSAGE_WINDOW_MS) {
    ws.messageWindowStart = now;
    ws.messageCount = 0;
  }
  ws.messageCount = (ws.messageCount || 0) + 1;
  return ws.messageCount <= MESSAGES_PER_WINDOW;
}
function clientIp(req: IncomingMessage) {
  const forwarded = req.headers["x-forwarded-for"];
  if (TRUST_PROXY && typeof forwarded === "string" && forwarded)
    return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
function send(ws: WebSocket, payload: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function generateRoomCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomInt(100000, 1000000).toString();
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}
function relay(ws: Client, payload: object) {
  if (!ws.room) return;
  const room = rooms.get(ws.room);
  if (!room) return;
  for (const client of room.clients) if (client !== ws) send(client, payload);
}
function joinRoom(ws: Client, code: string, created = false) {
  const room = rooms.get(code);
  if (!room) {
    send(ws, {
      type: "error",
      code: "ROOM_NOT_FOUND",
      message: "That room does not exist or has expired.",
    });
    return;
  }
  if (room.clients.size >= 2 && !room.clients.has(ws)) {
    send(ws, { type: "error", code: "ROOM_FULL", message: "That room already has two devices." });
    return;
  }
  if (room.cleanup) {
    clearTimeout(room.cleanup);
    room.cleanup = undefined;
  }
  room.clients.add(ws);
  ws.room = code;
  send(
    ws,
    created
      ? { type: "created", room: code }
      : { type: "joined", room: code, text: room.latestText, peerConnected: room.clients.size > 1 },
  );
  relay(ws, { type: "peer", connected: true });
}
function detach(ws: Client) {
  if (!ws.room) return;
  const code = ws.room;
  const room = rooms.get(code);
  ws.room = undefined;
  if (!room) return;
  room.clients.delete(ws);
  for (const client of room.clients) send(client, { type: "peer", connected: false });
  if (room.clients.size === 0) room.latestText = "";
  if (room.clients.size === 0)
    room.cleanup = setTimeout(() => {
      const current = rooms.get(code);
      if (current && current.clients.size === 0) rooms.delete(code);
    }, ROOM_GRACE_MS);
}

function handleMessage(ws: Client, raw: WebSocket.RawData) {
  let data: any;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    send(ws, { type: "error", code: "BAD_JSON", message: "Invalid message." });
    return;
  }
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    send(ws, { type: "error", code: "BAD_JSON", message: "Invalid message." });
    return;
  }
  if ((data.type === "create" || data.type === "join") && !allowRoomAttempt(ws.ip || "unknown")) {
    send(ws, {
      type: "error",
      code: "RATE_LIMITED",
      message: "Too many attempts. Wait a minute and try again.",
    });
    return;
  }
  if (data.type === "create" && rooms.size >= MAX_ROOMS) {
    send(ws, {
      type: "error",
      code: "SERVER_BUSY",
      message: "The server is busy. Try again shortly.",
    });
    return;
  }
  if (data.type === "create") {
    detach(ws);
    const code = generateRoomCode();
    rooms.set(code, { clients: new Set(), latestText: "" });
    joinRoom(ws, code, true);
    return;
  }
  if (data.type === "join") {
    const code = String(data.room || "");
    if (!/^\d{6}$/.test(code)) {
      send(ws, {
        type: "error",
        code: "BAD_ROOM",
        message: "Room codes contain exactly 6 digits.",
      });
      return;
    }
    detach(ws);
    joinRoom(ws, code);
    return;
  }
  if (data.type === "text") {
    if (!ws.room) {
      send(ws, { type: "error", code: "NOT_IN_ROOM", message: "Join a room before sending text." });
      return;
    }
    const text = typeof data.text === "string" ? data.text : "";
    if (!text || text.length > MAX_TEXT_LENGTH) {
      send(ws, {
        type: "error",
        code: "BAD_TEXT",
        message: "Text must be between 1 and 50,000 characters.",
      });
      return;
    }
    const room = rooms.get(ws.room);
    if (!room) return;
    room.latestText = text;
    relay(ws, { type: "text", text });
    return;
  }
  if (["rtc-offer", "rtc-answer", "rtc-ice"].includes(data.type)) {
    if (!ws.room) return;
    relay(ws, data);
    return;
  }
  send(ws, { type: "error", code: "UNKNOWN_TYPE", message: "Unknown request." });
}

wss.on("connection", (ws: Client, req) => {
  ws.alive = true;
  ws.ip = clientIp(req);
  ws.on("pong", () => {
    ws.alive = true;
  });
  ws.on("message", (raw) => {
    if (!allowMessage(ws)) {
      ws.close(1008, "Rate limit exceeded");
      return;
    }
    try {
      handleMessage(ws, raw);
    } catch (err) {
      console.error("Failed to handle message", err);
      send(ws, { type: "error", code: "SERVER_ERROR", message: "Something went wrong." });
    }
  });
  ws.on("close", () => detach(ws));
  ws.on("error", () => detach(ws));
});

// Drop sockets that stop answering pings (e.g. a phone that lost signal) so they free their room slot.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients as Set<Client>) {
    if (!ws.alive) {
      detach(ws);
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [ip, entry] of roomAttempts)
    if (now - entry.windowStart >= ROOM_ATTEMPT_WINDOW_MS) roomAttempts.delete(ip);
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));
httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`Dera Share realtime server listening on ${PORT}`),
);
