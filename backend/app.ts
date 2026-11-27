import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { LogController } from "fastify";
import { connectDb } from "./src/db.ts";
import { verifyMailer } from "./src/lib/mailer.ts";
import { authRoutes } from "./src/routes/auth.ts";
import { workspaceRoutes } from "./src/routes/workspaces.ts";
import { waitlistRoutes } from "./src/routes/waitlist.ts";
import { backfillDefaults } from "./src/lib/defaults.ts";

const PORT = Number(process.env.PORT ?? 4000);
// Allowed frontend origins: CLIENT_ORIGIN (comma-separated) if set, otherwise any localhost port.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN?.split(",").map((o) => o.trim()) ?? /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

const app = Fastify({
  // Skip per-request lines; keep the console to our own messages (sign-ups, saves, errors).
  logController: new LogController({ disableRequestLogging: true }),
  logger: {
    // Readable, colored logs in dev; plain JSON in production.
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname,reqId" } },
  },
});

// credentials: true lets the browser send the session cookie cross-origin (frontend :3000 → API :4000).
await app.register(cors, { origin: CLIENT_ORIGIN, credentials: true });
await app.register(cookie);
// Log every failed request with the reason — validation errors otherwise vanish silently
// because per-request logging is off.
app.setErrorHandler((err, req, reply) => {
  const route = `${req.method} ${req.url}`;
  if (err.validation) {
    // Never log auth bodies — they contain passwords.
    const body = req.url.startsWith("/api/auth") ? "[hidden]" : req.body;
    req.log.warn({ route, problem: err.message, details: err.validation, body }, "❌ Request rejected: invalid body");
    return reply.code(400).send({ message: err.message, errors: {} });
  }
  req.log.error({ route, err: err.message, stack: err.stack }, "💥 Request failed");
  return reply.code(err.statusCode ?? 500).send({ message: (err.statusCode ?? 500) < 500 ? err.message : "Something went wrong on our side." });
});

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(workspaceRoutes, { prefix: "/api/workspaces" });
await app.register(waitlistRoutes, { prefix: "/api/waitlist" });

app.get("/api/health", async () => ({ ok: true }));

try {
  await connectDb();
  await backfillDefaults(app.log);
  await verifyMailer()
    .then(() => app.log.info("📮 SMTP ready"))
    .catch((err) => app.log.error({ err: err.message }, "📮 SMTP login failed — verification emails won't send"));
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
