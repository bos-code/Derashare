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

### Checks

These run in CI (`.github/workflows/ci.yml`) on every push to `main` and every pull request:

```bash
npm run format:check                     # Prettier, whole repo (npm run format to fix)
npm --prefix server run typecheck        # server source and tests
npm --prefix server test                 # server integration tests
npm --prefix client run lint             # ESLint (Next.js rules)
npm --prefix client run typecheck
npm run build
```

### Layout

- `server/src/realtime.ts`: room, relay, rate-limit and heartbeat logic (`createRealtimeServer`)
- `server/src/index.ts`: reads environment variables and starts the server
- `client/hooks/useRoomSocket.ts`: WebSocket connection, reconnects and room state
- `client/hooks/usePeerTransfer.ts`: WebRTC negotiation and file transfer
- `client/components/`: UI pieces composed by `client/app/page.tsx`
- `client/lib/`: message types and file helpers

## Environment

Copy `.env.example` to `client/.env.local`:

```env
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

Production must use a secure `wss://` endpoint.

Server environment variables (all optional):

| Variable          | Purpose                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins allowed to connect, e.g. `https://derashare.vercel.app`. Unset allows any origin, which is only appropriate for local development. |
| `TRUST_PROXY`     | Set to `1` behind a reverse proxy (Render, Railway) so rate limits use the client IP from `x-forwarded-for`.                                                        |
| `MAX_ROOMS`       | Maximum concurrent rooms. Defaults to `10000`.                                                                                                                      |

## Security model

- Room codes are short, so the server limits each IP to 15 create/join attempts per minute and each connection to 300 messages per 10 seconds.
- Text is kept in server memory only while a device is in the room, and is cleared as soon as the room is empty.
- Files go directly between devices over an encrypted WebRTC data channel and never touch the server.
- Received files are only previewed when they are a known image type. Everything else is offered as a plain download.

## Deployment

Deploy `client/` to Vercel. Deploy `server/` to a persistent Node.js host that supports WebSockets, such as Render or Railway. Set `NEXT_PUBLIC_WS_URL` on the frontend to the public WebSocket server URL, and set `ALLOWED_ORIGINS` on the server to the frontend URL.

The server exposes `GET /health` for host health checks.
