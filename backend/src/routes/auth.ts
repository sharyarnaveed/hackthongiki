import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import { sendVerificationEmail } from "../lib/mailer.ts";
import { rateLimiter } from "../lib/onboarding.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import { authUserOf, endSession, requireAuth, startSession } from "../lib/session.ts";
import { issueNonce, verifySiwe } from "../lib/siwe.ts";
import { syncUserWorkspaces } from "../lib/ownership.ts";
import { CODE_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS, codeMatches, hashCode, newCode } from "../lib/verification.ts";
import { UserModel } from "../models/User.ts";
import { DEFAULT_PREFERENCES, preferencesOf, type Preferences } from "../lib/defaults.ts";

type SignUpBody = { fullName: string; email: string; dob: string; password: string };
type VerifyBody = { email: string; code: string };
type ResendBody = { email: string };
type SignInBody = { email: string; password: string; remember?: boolean };
type WalletBody = { message: string; signature: string; remember?: boolean };

// Password guessing: 10 sign-in attempts per IP per 15 minutes.
const signInLimit = rateLimiter(10, 15 * 60 * 1000);
// Wallet nonces: 30 per IP per 15 minutes (each one is a DB row until it expires).
const nonceLimit = rateLimiter(30, 15 * 60 * 1000);

/** A signed Sign-In with Ethereum message (EIP-4361) and its signature. */
const walletBodySchema = (withRemember: boolean) => ({
  type: "object",
  required: ["message", "signature"],
  additionalProperties: false,
  properties: {
    message: { type: "string", minLength: 1, maxLength: 4096 },
    signature: { type: "string", pattern: "^0x[0-9a-fA-F]+$", maxLength: 1024 },
    ...(withRemember ? { remember: { type: "boolean" } } : {}),
  },
});
const BAD_SIGNATURE = { message: "We couldn't verify that wallet signature. Try again." };

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
      return reply.send({ user: authUserOf(user) });
    },
  );

  /* ---------- Sign-In with Ethereum (EIP-4361) ---------- */

  /** Step 1: a one-time nonce to put in the message the wallet signs. */
  app.get("/wallet/nonce", async (req, reply) => {
    if (!nonceLimit(req.ip)) return reply.code(429).send({ message: "Too many wallet requests. Wait a few minutes and try again." });
    reply.header("Cache-Control", "no-store");
    return reply.send({ nonce: await issueNonce() });
  });

  /** Step 2: sign in with a wallet that's linked to an account. */
  app.post<{ Body: WalletBody }>("/wallet/signin", { schema: { body: walletBodySchema(true) } }, async (req, reply) => {
    if (!signInLimit(req.ip)) return reply.code(429).send({ message: "Too many sign-in attempts. Wait a few minutes and try again." });
    const check = await verifySiwe(req.body.message, req.body.signature, req.headers.origin, req.headers.host);
    if (!check.ok) {
      req.log.warn({ reason: check.reason }, "❌ Wallet sign-in failed");
      return reply.code(401).send(BAD_SIGNATURE);
    }
    const user = await UserModel.findOne({ walletAddress: check.address.toLowerCase() });
    if (!user) {
      req.log.warn({ wallet: check.address }, "❌ Wallet sign-in: no account linked");
      return reply.code(404).send({
        message: "No account is linked to this wallet yet. Sign in with your email, then link the wallet from your dashboard.",
        noAccount: true,
      });
    }
    if (!user.emailVerified) return reply.code(403).send({ message: "Verify your email before signing in.", needsVerification: true });
    await startSession(reply, user._id, req.body.remember ?? true);
    await UserModel.updateOne({ _id: user._id }, { $set: { lastSignInAt: new Date() } });
    req.log.info({ email: user.email, wallet: check.address }, "🔑 Signed in with wallet");
    return reply.send({ user: authUserOf(user) });
  });

  /** Link a wallet to the signed-in account (replaces any wallet linked before). */
  app.post<{ Body: WalletBody }>("/wallet/link", { onRequest: requireAuth, schema: { body: walletBodySchema(false) } }, async (req, reply) => {
    const check = await verifySiwe(req.body.message, req.body.signature, req.headers.origin, req.headers.host);
    if (!check.ok) {
      req.log.warn({ user: req.user!.email, reason: check.reason }, "❌ Wallet link failed");
      return reply.code(401).send(BAD_SIGNATURE);
    }
    const address = check.address.toLowerCase();
    const owner = await UserModel.findOne({ walletAddress: address }, { _id: 1 });
    const taken = { message: "This wallet is already linked to another account." };
    if (owner && owner.id !== req.user!.id) return reply.code(409).send(taken);
    let user;
    try {
      user = await UserModel.findByIdAndUpdate(req.user!.id, { $set: { walletAddress: address, walletLinkedAt: new Date() } }, { returnDocument: "after" });
    } catch (err) {
      // Unique-index race: two accounts linking the same wallet at once.
      if ((err as { code?: number }).code === 11000) return reply.code(409).send(taken);
      throw err;
    }
    if (!user) return reply.code(404).send({ message: "Account not found." });
    req.log.info({ user: user.email, wallet: check.address }, "👛 Wallet linked");
    // The new wallet may receive (or, as owner, holds) each workspace's ownership token.
    await syncUserWorkspaces(req.user!.id);
    return reply.send({ user: authUserOf(user) });
  });

  /** Unlink the wallet. Email + password keep working. */
  app.delete("/wallet", { onRequest: requireAuth }, async (req, reply) => {
    const user = await UserModel.findByIdAndUpdate(req.user!.id, { $unset: { walletAddress: 1, walletLinkedAt: 1 } }, { returnDocument: "after" });
    if (!user) return reply.code(404).send({ message: "Account not found." });
    req.log.info({ user: user.email }, "👛 Wallet unlinked");
    // Revoke it on every workspace's token; tokens it held go back to the app's custody.
    await syncUserWorkspaces(req.user!.id);
    return reply.send({ user: authUserOf(user) });
  });

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
