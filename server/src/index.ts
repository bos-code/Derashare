import { createRealtimeServer, defaultOptions } from "./realtime.js";

const PORT = Number(process.env.PORT || 8080);

const list = (value: string | undefined) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const { httpServer } = createRealtimeServer({
  // Comma-separated list such as "https://derashare.vercel.app".
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  trustProxy: process.env.TRUST_PROXY === "1",
  maxRooms: Number(process.env.MAX_ROOMS || defaultOptions.maxRooms),
  // e.g. "turn:turn.example.com:3478,turns:turn.example.com:5349"
  turnUrls: list(process.env.TURN_URLS),
  turnSecret: process.env.TURN_SECRET || undefined,
  turnUsername: process.env.TURN_USERNAME || undefined,
  turnCredential: process.env.TURN_CREDENTIAL || undefined,
});

httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`Dera Share realtime server listening on ${PORT}`),
);
