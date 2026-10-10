import { createRealtimeServer, defaultOptions } from "./realtime.js";

const PORT = Number(process.env.PORT || 8080);

const { httpServer } = createRealtimeServer({
  // Comma-separated list such as "https://derashare.vercel.app".
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === "1",
  maxRooms: Number(process.env.MAX_ROOMS || defaultOptions.maxRooms),
});

httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`Dera Share realtime server listening on ${PORT}`),
);
