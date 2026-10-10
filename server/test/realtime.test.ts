import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket, type ClientOptions } from "ws";
import { createHmac } from "node:crypto";
import {
  buildIceServers,
  createRealtimeServer,
  defaultOptions,
  type RealtimeOptions,
} from "../src/realtime.js";

type Message = { type: string; [key: string]: unknown };
type TestClient = WebSocket & { messages: Message[]; next: (type?: string) => Promise<Message> };

const servers: Array<() => Promise<void>> = [];
const sockets: WebSocket[] = [];

async function startServer(options: Partial<RealtimeOptions> = {}) {
  const { httpServer, close } = createRealtimeServer(options);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  servers.push(close);
  const { port } = httpServer.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${port}`, port };
}

// Connects and records every message; `next` waits for the next unread message (optionally of a type).
function connect(url: string, options?: ClientOptions): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options) as TestClient;
    sockets.push(ws);
    ws.messages = [];
    let read = 0;
    const waiters: Array<() => void> = [];
    ws.on("message", (raw) => {
      ws.messages.push(JSON.parse(raw.toString()));
      waiters.splice(0).forEach((w) => w());
    });
    ws.next = (type) =>
      new Promise((res, rej) => {
        const timer = setTimeout(
          () => rej(new Error(`Timed out waiting for ${type ?? "message"}`)),
          2000,
        );
        const check = () => {
          while (read < ws.messages.length) {
            const msg = ws.messages[read++];
            if (!type || msg.type === type) {
              clearTimeout(timer);
              res(msg);
              return;
            }
          }
          waiters.push(check);
        };
        check();
      });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

const send = (ws: WebSocket, payload: unknown) => ws.send(JSON.stringify(payload));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createRoom(url: string) {
  const host = await connect(url);
  send(host, { type: "create" });
  const created = await host.next("created");
  return { host, room: created.room as string };
}

afterEach(() => {
  for (const ws of sockets.splice(0)) ws.terminate();
});
after(async () => {
  await Promise.all(servers.map((close) => close()));
});

describe("realtime server", () => {
  it("answers health checks", async () => {
    const { port } = await startServer();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.deepEqual(await res.json(), { ok: true, rooms: 0 });
  });

  it("rejects malformed messages without crashing", async () => {
    const { url, port } = await startServer();
    const ws = await connect(url);
    for (const bad of ["null", "[]", "1", '"x"', "{}", '{"type":5}', "not json"]) ws.send(bad);
    for (let i = 0; i < 7; i++) assert.equal((await ws.next()).code, "BAD_JSON");
    send(ws, { type: "nope" });
    assert.equal((await ws.next()).code, "UNKNOWN_TYPE");
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
  });

  it("pairs two devices and relays text and WebRTC signals", async () => {
    const { url } = await startServer();
    const { host, room } = await createRoom(url);
    assert.match(room, /^\d{6}$/);

    const guest = await connect(url);
    send(guest, { type: "join", room });
    const joined = await guest.next("joined");
    assert.equal(joined.peerConnected, true);
    assert.deepEqual(await host.next("peer"), { type: "peer", connected: true });

    send(guest, { type: "text", text: "hello" });
    assert.deepEqual(await host.next("text"), { type: "text", text: "hello" });

    const offer = { type: "rtc-offer", sdp: { type: "offer", sdp: "v=0" } };
    send(host, offer);
    assert.deepEqual(await guest.next("rtc-offer"), offer);

    guest.close();
    assert.deepEqual(await host.next("peer"), { type: "peer", connected: false });
  });

  it("rejects a third device, unknown rooms and malformed codes", async () => {
    const { url } = await startServer();
    const { room } = await createRoom(url);
    const guest = await connect(url);
    send(guest, { type: "join", room });
    await guest.next("joined");

    const third = await connect(url);
    send(third, { type: "join", room });
    assert.equal((await third.next("error")).code, "ROOM_FULL");
    send(third, { type: "join", room: room === "999999" ? "999998" : "999999" });
    assert.equal((await third.next("error")).code, "ROOM_NOT_FOUND");
    send(third, { type: "join", room: "12ab" });
    assert.equal((await third.next("error")).code, "BAD_ROOM");
  });

  it("relays chat without storing it", async () => {
    const { url } = await startServer();
    const { host, room } = await createRoom(url);
    const guest = await connect(url);
    send(guest, { type: "join", room });
    await guest.next("joined");
    send(guest, { type: "chat", text: "psst" });
    assert.deepEqual(await host.next("chat"), { type: "chat", text: "psst" });

    // Not kept for devices that join later.
    guest.close();
    await host.next("peer");
    const rejoin = await connect(url);
    send(rejoin, { type: "join", room });
    assert.equal((await rejoin.next("joined")).text, "");

    send(rejoin, { type: "chat", text: "   " });
    assert.equal((await rejoin.next("error")).code, "BAD_TEXT");
    send(rejoin, { type: "chat", text: "x".repeat(2_001) });
    assert.equal((await rejoin.next("error")).code, "BAD_TEXT");
  });

  it("validates text and requires a room", async () => {
    const { url } = await startServer();
    const ws = await connect(url);
    send(ws, { type: "text", text: "hi" });
    assert.equal((await ws.next("error")).code, "NOT_IN_ROOM");
    send(ws, { type: "create" });
    await ws.next("created");
    send(ws, { type: "text", text: "" });
    assert.equal((await ws.next("error")).code, "BAD_TEXT");
    send(ws, { type: "text", text: "x".repeat(50_001) });
    assert.equal((await ws.next("error")).code, "BAD_TEXT");
  });

  it("keeps text for a reconnecting device but clears it once the room is empty", async () => {
    const { url } = await startServer();
    const { host, room } = await createRoom(url);
    const guest = await connect(url);
    send(guest, { type: "join", room });
    await guest.next("joined");
    send(host, { type: "text", text: "secret" });
    await guest.next("text");

    guest.close();
    await host.next("peer");
    const rejoin = await connect(url);
    send(rejoin, { type: "join", room });
    assert.equal((await rejoin.next("joined")).text, "secret");

    host.close();
    rejoin.close();
    await wait(100);
    const later = await connect(url);
    send(later, { type: "join", room });
    assert.equal((await later.next("joined")).text, "");
  });

  it("drops devices that stop answering pings", async () => {
    const { url } = await startServer({ heartbeatMs: 50 });
    const { host, room } = await createRoom(url);
    const silent = await connect(url, { autoPong: false });
    send(silent, { type: "join", room });
    await silent.next("joined");
    await host.next("peer");

    assert.deepEqual(await host.next("peer"), { type: "peer", connected: false });
    const replacement = await connect(url);
    send(replacement, { type: "join", room });
    await replacement.next("joined");
  });

  it("rate limits room attempts per IP", async () => {
    const { url } = await startServer({ roomAttemptsPerWindow: 3 });
    const ws = await connect(url);
    for (let i = 0; i < 5; i++) send(ws, { type: "join", room: String(100000 + i) });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await ws.next("error")).code);
    assert.deepEqual(codes, [
      "ROOM_NOT_FOUND",
      "ROOM_NOT_FOUND",
      "ROOM_NOT_FOUND",
      "RATE_LIMITED",
      "RATE_LIMITED",
    ]);
  });

  it("disconnects a connection that floods messages", async () => {
    const { url } = await startServer({ messagesPerWindow: 10 });
    const ws = await connect(url);
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    for (let i = 0; i < 20; i++) send(ws, { type: "rtc-ice" });
    assert.equal(await closed, 1008);
  });

  it("refuses to create rooms past the cap", async () => {
    const { url } = await startServer({ maxRooms: 1 });
    await createRoom(url);
    const ws = await connect(url);
    send(ws, { type: "create" });
    assert.equal((await ws.next("error")).code, "SERVER_BUSY");
  });

  it("only accepts allowed origins when configured", async () => {
    const { url } = await startServer({ allowedOrigins: ["https://ok.example"] });
    await assert.rejects(connect(url, { origin: "https://evil.example" }), /HTTP 401/);
    await connect(url, { origin: "https://ok.example" });
  });

  it("sends ICE servers with room responses", async () => {
    const { url } = await startServer({
      turnUrls: ["turn:turn.example:3478"],
      turnUsername: "user",
      turnCredential: "pass",
    });
    const host = await connect(url);
    send(host, { type: "create" });
    const created = await host.next("created");
    assert.deepEqual(created.iceServers, [
      { urls: defaultOptions.stunUrls },
      { urls: ["turn:turn.example:3478"], username: "user", credential: "pass" },
    ]);
    const guest = await connect(url);
    send(guest, { type: "join", room: created.room });
    assert.deepEqual((await guest.next("joined")).iceServers, created.iceServers);
  });
});

describe("buildIceServers", () => {
  it("uses only STUN when TURN isn't configured", () => {
    assert.deepEqual(buildIceServers(defaultOptions), [{ urls: defaultOptions.stunUrls }]);
  });

  it("issues expiring HMAC credentials for a shared TURN secret", () => {
    const now = Date.UTC(2026, 0, 1);
    const [, turn] = buildIceServers(
      { ...defaultOptions, turnUrls: ["turn:t.example"], turnSecret: "s3cret", turnTtlSeconds: 60 },
      now,
    );
    const [expiry] = turn.username!.split(":");
    assert.equal(Number(expiry), now / 1000 + 60);
    assert.equal(
      turn.credential,
      createHmac("sha1", "s3cret").update(turn.username!).digest("base64"),
    );
  });
});
