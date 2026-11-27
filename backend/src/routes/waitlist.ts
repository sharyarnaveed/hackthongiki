import type { FastifyPluginAsync } from "fastify";
import { EMAIL_RE, rateLimiter } from "../lib/onboarding.ts";
import { WaitlistModel } from "../models/Waitlist.ts";

// Spam guard: 5 sign-ups per IP per 10 minutes.
const waitlistLimit = rateLimiter(5, 10 * 60 * 1000);

/** The landing page's early-access form. Public: no account needed. */
export const waitlistRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { email: string } }>(
    "/",
    {
      schema: {
        body: { type: "object", required: ["email"], additionalProperties: false, properties: { email: { type: "string", maxLength: 254 } } },
      },
    },
    async (req, reply) => {
      if (!waitlistLimit(req.ip)) {
        req.log.warn({ ip: req.ip }, "⛔ Waitlist sign-up rate-limited");
        return reply.code(429).send({ message: "Too many tries. Wait a few minutes and try again." });
      }
      const email = req.body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        req.log.warn("❌ Waitlist sign-up rejected: invalid email");
        return reply.code(400).send({ message: "That email doesn't look quite right.", errors: { email: "That email doesn't look quite right." } });
      }
      // Upsert: signing up twice is fine and doesn't create a duplicate.
      const res = await WaitlistModel.updateOne({ email }, { $setOnInsert: { email, source: "landing" } }, { upsert: true });
      if (res.upsertedCount) req.log.info({ email }, "📝 Waitlist sign-up saved to MongoDB");
      else req.log.info({ email }, "ℹ️  Already on the waitlist — nothing added");
      return reply.code(res.upsertedCount ? 201 : 200).send({ ok: true, alreadyOnList: !res.upsertedCount });
    },
  );
};
