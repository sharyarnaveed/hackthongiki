import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

/** Frontend settings come from frontend/main.env. Values already in the environment (the shell) win. */
const mainEnv = path.resolve(process.cwd(), "main.env");
if (existsSync(mainEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(mainEnv, "utf8")))) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

/** The backend on this machine; the browser reaches it through /api on the frontend's own address. */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  cacheComponents: true,
  // Opened through an ngrok link: let those hosts load dev assets and hot reload.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io", ...(process.env.DEV_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])],
  partialPrefetching: true,
  // Browser-side settings from main.env, baked into the client bundle.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
    NEXT_PUBLIC_STUN_URLS: process.env.NEXT_PUBLIC_STUN_URLS ?? "",
  },
  // Only the frontend is tunnelled (ngrok http 3000): /api — REST and the live WebSocket — is forwarded to the backend.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
