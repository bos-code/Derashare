import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const MAX_TEXT_LENGTH = 50_000;

export type RealtimeOptions = {
  // Frontend origins allowed to connect. Empty allows any origin (local development).
  allowedOrigins: string[];
  // Behind a reverse proxy (Render, Railway) the client IP is in x-forwarded-for.
  trustProxy: boolean;
  maxRooms: number;
  // How long an empty room (and its code) stays reserved so a device can reconnect.
  roomGraceMs: number;
  heartbeatMs: number;
  // Room create/join attempts allowed per IP per window. Makes guessing 6-digit codes impractical.
  roomAttemptsPerWindow: number;
  roomAttemptWindowMs: number;
  // Any message type, per connection. Generous enough for WebRTC ICE bursts.
  messagesPerWindow: number;
  messageWindowMs: number;
  // ICE servers handed to clients for WebRTC. TURN relays file transfers when a direct connection
  // is impossible (symmetric NAT, many mobile networks).
  stunUrls: string[];
  turnUrls: string[];
  // coturn-style shared secret (`use-auth-secret`): each join gets short-lived credentials.
  turnSecret?: string;
  // Or fixed credentials, e.g. from a hosted TURN provider.
  turnUsername?: string;
  turnCredential?: string;
  turnTtlSeconds: number;
};

export const defaultOptions: RealtimeOptions = {
  allowedOrigins: [],
  trustProxy: false,
  maxRooms: 10_000,
  roomGraceMs: 5 * 60 * 1000,
  heartbeatMs: 25_000,
  roomAttemptsPerWindow: 15,
  roomAttemptWindowMs: 60_000,
  messagesPerWindow: 300,
  messageWindowMs: 10_000,
  stunUrls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  turnUrls: [],
  turnTtlSeconds: 12 * 60 * 60,
};

export type IceServer = { urls: string[]; username?: string; credential?: string };

export function buildIceServers(options: RealtimeOptions, now = Date.now()): IceServer[] {
  const servers: IceServer[] = [];
  if (options.stunUrls.length) servers.push({ urls: options.stunUrls });
  if (options.turnUrls.length && options.turnSecret) {
    const expiry = Math.floor(now / 1000) + options.turnTtlSeconds;
    const username = `${expiry}:${randomBytes(6).toString("hex")}`;
    const credential = createHmac("sha1", options.turnSecret).update(username).digest("base64");
    servers.push({ urls: options.turnUrls, username, credential });
  } else if (options.turnUrls.length && options.turnUsername && options.turnCredential) {
    servers.push({
      urls: options.turnUrls,
      username: options.turnUsername,
      credential: options.turnCredential,
    });
  }
  return servers;
}

type Client = WebSocket & {
  room?: string;
  alive?: boolean;
  ip?: string;
  messageCount?: number;
  messageWindowStart?: number;
};
type Room = { clients: Set<Client>; latestText: string; cleanup?: NodeJS.Timeout };

export function createRealtimeServer(overrides: Partial<RealtimeOptions> = {}): {
  httpServer: Server;
  close: () => Promise<void>;
} {
  const options = { ...defaultOptions, ...overrides };
  const rooms = new Map<string, Room>();

  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
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
      options.allowedOrigins.length === 0 || options.allowedOrigins.includes(origin),
  });

  const roomAttempts = new Map<string, { count: number; windowStart: number }>();
  function allowRoomAttempt(ip: string) {
    const now = Date.now();
    const entry = roomAttempts.get(ip);
    if (!entry || now - entry.windowStart >= options.roomAttemptWindowMs) {
      roomAttempts.set(ip, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    return entry.count <= options.roomAttemptsPerWindow;
  }
  function allowMessage(ws: Client) {
    const now = Date.now();
    if (!ws.messageWindowStart || now - ws.messageWindowStart >= options.messageWindowMs) {
      ws.messageWindowStart = now;
      ws.messageCount = 0;
    }
    ws.messageCount = (ws.messageCount || 0) + 1;
    return ws.messageCount <= options.messagesPerWindow;
  }
  function clientIp(req: IncomingMessage) {
    const forwarded = req.headers["x-forwarded-for"];
    if (options.trustProxy && typeof forwarded === "string" && forwarded)
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
        ? { type: "created", room: code, iceServers: buildIceServers(options) }
        : {
            type: "joined",
            room: code,
            text: room.latestText,
            peerConnected: room.clients.size > 1,
            iceServers: buildIceServers(options),
          },
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
      }, options.roomGraceMs);
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
    if (data.type === "create" && rooms.size >= options.maxRooms) {
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
        send(ws, {
          type: "error",
          code: "NOT_IN_ROOM",
          message: "Join a room before sending text.",
        });
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
      if (now - entry.windowStart >= options.roomAttemptWindowMs) roomAttempts.delete(ip);
  }, options.heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  async function close() {
    clearInterval(heartbeat);
    for (const room of rooms.values()) if (room.cleanup) clearTimeout(room.cleanup);
    rooms.clear();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  return { httpServer, close };
}
