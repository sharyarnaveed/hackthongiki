import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import { sendVerificationEmail } from "../lib/mailer.ts";
import { rateLimiter } from "../lib/onboarding.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import { endSession, requireAuth, startSession } from "../lib/session.ts";
import { CODE_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS, codeMatches, hashCode, newCode } from "../lib/verification.ts";
import { UserModel } from "../models/User.ts";
import { DEFAULT_PREFERENCES, preferencesOf, type Preferences } from "../lib/defaults.ts";

type SignUpBody = { fullName: string; email: string; dob: string; password: string };
type VerifyBody = { email: string; code: string };
type ResendBody = { email: string };
type SignInBody = { email: string; password: string; remember?: boolean };

// Password guessing: 10 sign-in attempts per IP per 15 minutes.
const signInLimit = rateLimiter(10, 15 * 60 * 1000);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAKEN = { message: "Email already registered.", errors: { email: "An account with this email already exists." } };

/** Give the user a fresh code (stored hashed) and email it. Returns false if sending failed. */
async function issueCode(userId: unknown, email: string, fullName: string, log: FastifyBaseLogger) {
  const code = newCode();
  await UserModel.updateOne(
    { _id: userId },
    {
      verificationCodeHash: hashCode(code),
      verificationCodeExpires: new Date(Date.now() + CODE_TTL_MS),
      verificationSentAt: new Date(),
      verificationAttempts: 0,
    },
  );
  try {
    await sendVerificationEmail(email, fullName, code);
    log.info({ email }, "📧 Verification code emailed");
    return true;
  } catch (err) {
    log.error({ email, err: (err as Error).message }, "❌ Failed to send verification email");
    return false;
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: SignUpBody }>(
    "/signup",
    {
      schema: {
        body: {
          type: "object",
          required: ["fullName", "email", "dob", "password"],
          additionalProperties: false,
          properties: {
            fullName: { type: "string", minLength: 1, maxLength: 100 },
            email: { type: "string", maxLength: 254 },
            dob: { type: "string", format: "date" },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (req, reply) => {
      const fullName = req.body.fullName.trim();
      const email = req.body.email.trim().toLowerCase();
      const dob = new Date(req.body.dob);

      req.log.info({ email }, "📝 Sign-up attempt");

      const errors: Record<string, string> = {};
      if (!fullName) errors.fullName = "Tell us what to put on your name tag.";
      if (!EMAIL_RE.test(email)) errors.email = "That email doesn't look quite right.";
      if (Number.isNaN(dob.getTime())) errors.dob = "Pick your date of birth.";
      else if (dob > new Date()) errors.dob = "That date is in the future.";
      if (Object.keys(errors).length) {
        req.log.warn({ email, errors }, "❌ Sign-up rejected: invalid details");
        return reply.code(400).send({ message: "Invalid sign-up details.", errors });
      }

      // One account per email: never let an existing email sign up again.
      const existing = await UserModel.findOne({ email });
      if (existing) {
        req.log.warn({ email, verified: existing.emailVerified }, "⚠️  Sign-up rejected: email already registered");
        if (existing.emailVerified) return reply.code(409).send(TAKEN);
        return reply.code(409).send({
          message: "Email already registered.",
          needsVerification: true,
          errors: { email: "This email is already registered but not verified yet." },
        });
      }

      let user;
      try {
        // New accounts start with the default office settings, written to the document.
        user = await UserModel.create({ fullName, email, dob, passwordHash: await hashPassword(req.body.password), preferences: { ...DEFAULT_PREFERENCES } });
        req.log.info(
          { id: user.id, email: user.email, db: user.db.name, collection: user.collection.name, preferences: preferencesOf(user.preferences) },
          "✅ User saved to MongoDB",
        );
      } catch (err) {
        // Unique-index race: two sign-ups with the same email at once.
        if ((err as { code?: number }).code === 11000) return reply.code(409).send(TAKEN);
        throw err;
      }

      const emailSent = await issueCode(user._id, email, fullName, req.log);
      return reply.code(201).send({
        user: { id: user.id, fullName, email, emailVerified: false },
        emailSent,
      });
    },
  );

  app.post<{ Body: VerifyBody }>(
    "/verify-email",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "code"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 254 }, code: { type: "string", pattern: "^[0-9]{6}$" } },
        },
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      const user = await UserModel.findOne({ email }).select(
        "+verificationCodeHash +verificationCodeExpires +verificationAttempts",
      );
      const fail = (msg: string) => reply.code(400).send({ message: msg });

      if (!user) return fail("That code isn't right. Check the email and try again.");
      if (user.emailVerified) return reply.send({ verified: true });
      if (!user.verificationCodeHash || !user.verificationCodeExpires || user.verificationCodeExpires < new Date()) {
        req.log.warn({ email }, "⌛ Verification code expired");
        return fail("That code has expired. Send a new one below.");
      }
      if ((user.verificationAttempts ?? 0) >= MAX_ATTEMPTS) {
        req.log.warn({ email }, "🚫 Too many verification attempts");
        return fail("Too many wrong tries. Send a new code below.");
      }

      if (!codeMatches(req.body.code, user.verificationCodeHash)) {
        await UserModel.updateOne({ _id: user._id }, { $inc: { verificationAttempts: 1 } });
        req.log.warn({ email }, "❌ Wrong verification code");
        return fail("That code isn't right. Check the email and try again.");
      }

      await UserModel.updateOne(
        { _id: user._id },
        {
          emailVerified: true,
          $unset: { verificationCodeHash: 1, verificationCodeExpires: 1, verificationSentAt: 1, verificationAttempts: 1 },
        },
      );
      req.log.info({ email }, "🎉 Email verified");
      // Proving the email is enough to sign them in straight away.
      await startSession(reply, user._id);
      return reply.send({ verified: true });
    },
  );

  app.post<{ Body: ResendBody }>(
    "/resend-verification",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 254 } },
        },
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      const user = await UserModel.findOne({ email }).select("+verificationSentAt");
      // Same reply whether or not the account exists, so this can't be used to probe emails.
      const ok = { message: "If that account needs verifying, a new code is on its way." };
      if (!user || user.emailVerified) return reply.send(ok);

      const wait = (user.verificationSentAt?.getTime() ?? 0) + RESEND_COOLDOWN_MS - Date.now();
      if (wait > 0) {
        return reply.code(429).send({ message: `Please wait ${Math.ceil(wait / 1000)}s before asking for another code.` });
      }

      const sent = await issueCode(user._id, email, user.fullName, req.log);
      if (!sent) return reply.code(502).send({ message: "We couldn't send the email. Try again in a moment." });
      return reply.send(ok);
    },
  );

  app.post<{ Body: SignInBody }>(
    "/signin",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", maxLength: 254 },
            password: { type: "string", minLength: 1, maxLength: 128 },
            remember: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      if (!signInLimit(req.ip)) return reply.code(429).send({ message: "Too many sign-in attempts. Wait a few minutes and try again." });
      const email = req.body.email.trim().toLowerCase();
      const user = await UserModel.findOne({ email }).select("+passwordHash");
      // Same message for unknown email and wrong password, so this can't be used to probe accounts.
      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        req.log.warn({ email }, "❌ Sign-in failed");
        return reply.code(401).send({ message: "That email and password don't match." });
      }
      if (!user.emailVerified) {
        return reply.code(403).send({ message: "Verify your email before signing in.", needsVerification: true });
      }
      await startSession(reply, user._id, req.body.remember ?? true);
      await UserModel.updateOne({ _id: user._id }, { $set: { lastSignInAt: new Date() } });
      req.log.info({ email }, "🔑 Signed in");
      return reply.send({ user: { id: user.id, fullName: user.fullName, email: user.email, preferences: preferencesOf(user.preferences) } });
    },
  );

  app.post("/signout", async (req, reply) => {
    await endSession(req, reply);
    return reply.send({ ok: true });
  });

  /** Who is signed in. 401 if nobody. */
  app.get("/me", { onRequest: requireAuth }, async (req) => ({ user: req.user }));

  /** Save office settings (music, minimap, name tag). Only the keys sent are changed. */
  app.patch<{ Body: Partial<Preferences> }>(
    "/me/preferences",
    {
      onRequest: requireAuth,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { sound: { type: "boolean" }, minimap: { type: "boolean" }, nameTag: { type: "boolean" } },
        },
      },
    },
    async (req, reply) => {
      const set = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [`preferences.${k}`, v]));
      const user = await UserModel.findByIdAndUpdate(req.user!.id, { $set: set }, { returnDocument: "after" });
      if (!user) return reply.code(404).send({ message: "Account not found." });
      const preferences = preferencesOf(user.preferences);
      req.log.info({ user: req.user!.email, changed: req.body, preferences }, "⚙️  Preferences saved to MongoDB");
      return reply.send({ preferences });
    },
  );
};
