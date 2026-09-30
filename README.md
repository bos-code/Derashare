# Dera Share

A lightweight real-time text bridge between two paired devices. No account and no database.

## V1

- Secure 6-digit temporary rooms
- Maximum 2 devices per room
- Bidirectional real-time text sharing over WebSockets
- Copy and paste controls using the browser Clipboard API
- Peer connection state and automatic reconnect
- 5-minute empty-room grace period
- No permanent message storage
- Installable PWA metadata

## Architecture

`client/` is a Next.js + TypeScript frontend. `server/` is a small Node.js + `ws` relay. Rooms and their latest text live only in server memory and disappear after the room expires or the server restarts.

## Development

Requires Node.js 20+.

```bash
npm run install:all
npm run dev
```

Open `http://localhost:3000`. The WebSocket server runs on port `8080`.

## Environment

Copy `.env.example` to `client/.env.local`:

```env
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

Production must use a secure `wss://` endpoint.

## Deployment

Deploy `client/` to Vercel. Deploy `server/` to a persistent Node.js host that supports WebSockets, such as Render or Railway. Set `NEXT_PUBLIC_WS_URL` on the frontend to the public WebSocket server URL.

The server exposes `GET /health` for host health checks.
