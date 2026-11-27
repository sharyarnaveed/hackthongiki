import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { SessionModel } from "../models/Session.ts";
import { UserModel } from "../models/User.ts";
import { preferencesOf, type Preferences } from "./defaults.ts";

export const SESSION_COOKIE = "session";
const DAY = 24 * 60 * 60 * 1000;
/** "Remember me" keeps you signed in for 30 days; otherwise until the browser closes (server-side cap: 1 day). */
const REMEMBER_MS = 30 * DAY;
const SHORT_MS = DAY;

export type AuthUser = { id: string; fullName: string; email: string; preferences: Preferences };

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth`. */
    user?: AuthUser;
  }
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const cookieBase = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/** Start a session for `userId` and set the cookie on the reply. */
export async function startSession(reply: FastifyReply, userId: unknown, remember = true) {
  const token = randomBytes(32).toString("base64url");
  const ttl = remember ? REMEMBER_MS : SHORT_MS;
  await SessionModel.create({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + ttl) });
  reply.setCookie(SESSION_COOKIE, token, remember ? { ...cookieBase, maxAge: ttl / 1000 } : cookieBase);
  reply.log.info({ userId: String(userId), days: ttl / DAY }, "🍪 Session cookie issued");
}

export async function endSession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await SessionModel.deleteOne({ tokenHash: hashToken(token) });
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

type Lookup = { user: AuthUser; reason?: never } | { user: null; reason: string };

/** The signed-in, verified user for this request — or why there isn't one (for logs). */
async function lookup(req: FastifyRequest): Promise<Lookup> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return { user: null, reason: "no session cookie on the request" };
  const session = await SessionModel.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return { user: null, reason: "session cookie unknown or expired" };
  const user = await UserModel.findById(session.userId);
  if (!user) return { user: null, reason: "session's user no longer exists" };
  if (!user.emailVerified) return { user: null, reason: "user's email isn't verified" };
  return { user: { id: user.id, fullName: user.fullName, email: user.email, preferences: preferencesOf(user.preferences) } };
}

export async function currentUser(req: FastifyRequest): Promise<AuthUser | null> {
  return (await lookup(req)).user;
}

/** Route guard: 401 unless signed in. Use as `{ onRequest: requireAuth }` or `app.addHook("onRequest", requireAuth)` — runs before body validation. */
export const requireAuth: onRequestAsyncHookHandler = async (req, reply) => {
  const { user, reason } = await lookup(req);
  if (!user) {
    req.log.warn({ route: `${req.method} ${req.url}`, reason, origin: req.headers.origin }, "🔒 Not signed in — request rejected (401)");
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(401).send({ message: "Please sign in to continue." });
  }
  req.user = user;
};
