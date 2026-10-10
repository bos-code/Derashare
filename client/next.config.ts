import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo root also has a lockfile (for Prettier); keep tracing scoped to the client app.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
