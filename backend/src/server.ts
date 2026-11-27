import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { LogController, type FastifyError } from "fastify";
import { authRoutes } from "./routes/auth.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { waitlistRoutes } from "./routes/waitlist.ts";

// Allowed frontend origins: CLIENT_ORIGIN (comma-separated) if set, otherwise any localhost port.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN?.split(",").map((o) => o.trim()) ?? /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/** Routes whose request bodies must never be logged (passwords, codes). */
const SECRET_BODY = /^\/api\/auth/;

/**
 * Build the API without connecting to MongoDB or listening, so tests can boot
 * it with `app.inject()`. `app.ts` connects and listens.
 *
 * Logging:
 *   LOG_LEVEL     — pino level (default "info"; tests use "silent").
 *   LOG_REQUESTS  — "off" hides the one-line access log for every request.
 */
export async function buildApp() {
  const isProd = process.env.NODE_ENV === "production";
  const app = Fastify({
    // Fastify's own request/response lines are noisy; we write one compact line ourselves below.
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Readable, colored logs in dev; plain JSON in production.
      transport: isProd || process.env.LOG_LEVEL === "silent"
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname,reqId" } },
    },
  });

  // credentials: true lets the browser send the session cookie cross-origin (frontend :3000 → API :4000).
  await app.register(cors, { origin: CLIENT_ORIGIN, credentials: true });
  await app.register(cookie);

  // One access line per request: method, path, status, time and who asked.
  if (process.env.LOG_REQUESTS !== "off") {
    app.addHook("onResponse", async (req, reply) => {
      if (req.method === "OPTIONS" || req.url === "/api/health") return;
      const ms = Math.round(reply.elapsedTime);
      const line = { status: reply.statusCode, ms, user: req.user?.email };
      const msg = `↔️  ${req.method} ${req.url.split("?")[0]} → ${reply.statusCode} (${ms}ms)`;
      if (reply.statusCode >= 500) req.log.error(line, msg);
      else if (reply.statusCode >= 400 || ms > 1000) req.log.warn(line, msg);
      else req.log.info(line, msg);
    });
  }

  // Log every failed request with the reason — validation errors otherwise vanish silently.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const route = `${req.method} ${req.url}`;
    if (err.validation) {
      // Never log auth bodies — they contain passwords.
      const body = SECRET_BODY.test(req.url) ? "[hidden]" : req.body;
      req.log.warn({ route, problem: err.message, details: err.validation, body }, "❌ Request rejected: invalid body");
      return reply.code(400).send({ message: err.message, errors: {} });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ route, user: req.user?.email, err: err.message, stack: err.stack }, "💥 Request failed");
    else req.log.warn({ route, err: err.message }, "⚠️  Request refused");
    return reply.code(status).send({ message: status < 500 ? err.message : "Something went wrong on our side." });
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(workspaceRoutes, { prefix: "/api/workspaces" });
  await app.register(waitlistRoutes, { prefix: "/api/waitlist" });

  app.get("/api/health", async () => ({ ok: true }));

  return app;
}
