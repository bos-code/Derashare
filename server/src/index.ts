import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8080);
const MAX_TEXT_LENGTH = 50_000;
const ROOM_GRACE_MS = 5 * 60 * 1000;

type Client = WebSocket & { room?: string };
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

const wss = new WebSocketServer({ server: httpServer, maxPayload: 128 * 1024 });
function send(ws: WebSocket, payload: object) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function generateRoomCode() {
  for (let i = 0; i < 20; i++) { const code = randomInt(100000, 1000000).toString(); if (!rooms.has(code)) return code; }
  throw new Error("Could not allocate a room code");
}
function relay(ws: Client, payload: object) {
  if (!ws.room) return;
  const room = rooms.get(ws.room); if (!room) return;
  for (const client of room.clients) if (client !== ws) send(client, payload);
}
function joinRoom(ws: Client, code: string, created = false) {
  const room = rooms.get(code);
  if (!room) { send(ws, { type: "error", code: "ROOM_NOT_FOUND", message: "That room does not exist or has expired." }); return; }
  if (room.clients.size >= 2 && !room.clients.has(ws)) { send(ws, { type: "error", code: "ROOM_FULL", message: "That room already has two devices." }); return; }
  if (room.cleanup) { clearTimeout(room.cleanup); room.cleanup = undefined; }
  room.clients.add(ws); ws.room = code;
  send(ws, created ? { type: "created", room: code } : { type: "joined", room: code, text: room.latestText, peerConnected: room.clients.size > 1 });
  relay(ws, { type: "peer", connected: true });
}
function detach(ws: Client) {
  if (!ws.room) return;
  const code = ws.room; const room = rooms.get(code); ws.room = undefined; if (!room) return;
  room.clients.delete(ws); for (const client of room.clients) send(client, { type: "peer", connected: false });
  if (room.clients.size === 0) room.cleanup = setTimeout(() => { const current = rooms.get(code); if (current && current.clients.size === 0) rooms.delete(code); }, ROOM_GRACE_MS);
}

wss.on("connection", (ws: Client) => {
  ws.on("message", (raw) => {
    let data: any; try { data = JSON.parse(raw.toString()); } catch { send(ws, { type: "error", code: "BAD_JSON", message: "Invalid message." }); return; }
    if (data.type === "create") { detach(ws); const code = generateRoomCode(); rooms.set(code, { clients: new Set(), latestText: "" }); joinRoom(ws, code, true); return; }
    if (data.type === "join") { const code = String(data.room || ""); if (!/^\d{6}$/.test(code)) { send(ws, { type: "error", code: "BAD_ROOM", message: "Room codes contain exactly 6 digits." }); return; } detach(ws); joinRoom(ws, code); return; }
    if (data.type === "text") {
      if (!ws.room) { send(ws, { type: "error", code: "NOT_IN_ROOM", message: "Join a room before sending text." }); return; }
      const text = typeof data.text === "string" ? data.text : "";
      if (!text || text.length > MAX_TEXT_LENGTH) { send(ws, { type: "error", code: "BAD_TEXT", message: "Text must be between 1 and 50,000 characters." }); return; }
      const room = rooms.get(ws.room); if (!room) return; room.latestText = text; relay(ws, { type: "text", text }); return;
    }
    if (["rtc-offer", "rtc-answer", "rtc-ice"].includes(data.type)) { if (!ws.room) return; relay(ws, data); return; }
    send(ws, { type: "error", code: "UNKNOWN_TYPE", message: "Unknown request." });
  });
  ws.on("close", () => detach(ws)); ws.on("error", () => detach(ws));
});
httpServer.listen(PORT, "0.0.0.0", () => console.log(`Dera Share realtime server listening on ${PORT}`));
