import { live } from "../live/hub.ts";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { sendInvitationEmail, sendOwnershipEmail, sendRemovedEmail } from "../lib/mailer.ts";
import { EMAIL_RE, LIMITS, formatCode, newInviteCode, rateLimiter } from "../lib/onboarding.ts";
import { canManage, canRemove } from "../lib/roles.ts";
import { assignDesks } from "../lib/desks.ts";
import { syncWorkspace } from "../lib/ownership.ts";
import {
  NOT_FOUND,
  codeIsActive,
  handOver,
  invitationsView,
  inviteView,
  memberView,
  memberWorkspace,
  mid,
  saveDesks,
  type Ws,
} from "../lib/workspace.ts";
import { UserModel } from "../models/User.ts";
import { WorkspaceModel } from "../models/Workspace.ts";

/** How long an invite code can last, in days (null = forever). */
const MAX_EXPIRY_DAYS = 90;
/** Pending invitations a workspace can hold. */
const MAX_PENDING = 100;
/** Wait between two emails to the same person. */
const RESEND_COOLDOWN_MS = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Spam guard: 60 invitation emails per user per hour.
const inviteLimit = rateLimiter(60, 60 * 60 * 1000);

const expiresIn = { anyOf: [{ type: "integer", minimum: 1, maximum: MAX_EXPIRY_DAYS }, { type: "null" }] };
const expiryFrom = (days: number | null | undefined) => (days ? new Date(Date.now() + days * DAY) : null);

/**
 * Owners and admins: the invite code, invitations and members.
 * Owners only: changing roles and handing the workspace to someone else.
 * Registered inside `workspaceRoutes`, so every route here is signed-in.
 */
export const teamRoutes: FastifyPluginAsync = async (app) => {
  /** Load the workspace and check the caller may manage it; replies 404/403 itself. */
  async function managed(id: string, req: FastifyRequest, reply: FastifyReply, what: string, ownerOnly = false) {
    const found = await memberWorkspace(id, req.user!.id, req.log);
    if (!found) {
      reply.code(404).send(NOT_FOUND);
      return null;
    }
    const allowed = ownerOnly ? found.me.role === "owner" : canManage(found.me.role);
    if (!allowed) {
      req.log.warn({ id, user: req.user!.email, role: found.me.role, what }, `⛔ ${what} rejected: needs ${ownerOnly ? "the owner" : "an owner or admin"}`);
      reply.code(403).send({ message: ownerOnly ? "Only the workspace owner can do that." : "Only owners and admins can do that." });
      return null;
    }
    return found;
  }

  /* ───────────── Invite code ───────────── */

  /** The invite code, when it expires, and whether it still works. */
  app.get<{ Params: { id: string } }>("/:id/invite", async (req, reply) => {
    const found = await managed(req.params.id, req, reply, "Invite code view");
    if (!found) return;
    req.log.info({ id: found.ws.id, user: req.user!.email, active: codeIsActive(found.ws) }, "🎟️  Invite code viewed");
    return reply.send(inviteView(found.ws, formatCode));
  });

  /** Make a new code (the old one stops working at once); optionally set an expiry. */
  app.post<{ Params: { id: string }; Body: { expiresInDays?: number | null } }>(
    "/:id/invite/regenerate",
    { schema: { body: { type: "object", additionalProperties: false, properties: { expiresInDays: expiresIn } } } },
    async (req, reply) => {
      const found = await managed(req.params.id, req, reply, "Invite code regenerate");
      if (!found) return;
      const { ws } = found;
      const old = formatCode(ws.inviteCode);
      const expires = req.body?.expiresInDays === undefined ? ws.inviteCodeExpires && ws.inviteCodeExpires > new Date() ? ws.inviteCodeExpires : null : expiryFrom(req.body.expiresInDays);
      for (let attempt = 0; ; attempt++) {
        try {
          ws.inviteCode = newInviteCode();
          ws.inviteCodeRevoked = false;
          ws.inviteCodeExpires = expires ?? undefined;
          await ws.save();
          break;
        } catch (err) {
          if ((err as { code?: number }).code === 11000 && attempt < 4) {
            req.log.warn({ attempt }, "♻️  Invite code collision, retrying");
            continue;
          }
          throw err;
        }
      }
      req.log.info({ id: ws.id, by: req.user!.email, old, new: formatCode(ws.inviteCode), expiresAt: ws.inviteCodeExpires ?? "never" }, "🔄 Invite code regenerated — saved to MongoDB");
      return reply.send(inviteView(ws, formatCode));
    },
  );

  /** Revoke or restore the code, and/or change when it expires. */
  app.patch<{ Params: { id: string }; Body: { revoked?: boolean; expiresInDays?: number | null } }>(
    "/:id/invite",
    {
      schema: {
        body: { type: "object", minProperties: 1, additionalProperties: false, properties: { revoked: { type: "boolean" }, expiresInDays: expiresIn } },
      },
    },
    async (req, reply) => {
      const found = await managed(req.params.id, req, reply, "Invite code change");
      if (!found) return;
      const { ws } = found;
      const from = { revoked: !!ws.inviteCodeRevoked, expiresAt: ws.inviteCodeExpires ?? null };
      if (req.body.revoked !== undefined) ws.inviteCodeRevoked = req.body.revoked;
      if (req.body.expiresInDays !== undefined) ws.inviteCodeExpires = expiryFrom(req.body.expiresInDays) ?? undefined;
      await ws.save();
      req.log.info(
        { id: ws.id, by: req.user!.email, from, to: { revoked: ws.inviteCodeRevoked, expiresAt: ws.inviteCodeExpires ?? null }, active: codeIsActive(ws) },
        ws.inviteCodeRevoked ? "🚫 Invite code revoked — saved to MongoDB" : "🎟️  Invite code updated — saved to MongoDB",
      );
      return reply.send(inviteView(ws, formatCode));
    },
  );

  /* ───────────── Invitations ───────────── */

  /** Email the invite code to each address and remember it on the invitation. Returns who it reached. */
  async function sendInvites(ws: Ws, emails: string[], inviter: string, log: typeof app.log) {
    const results = await Promise.allSettled(emails.map((e) => sendInvitationEmail(e, inviter, ws.name, formatCode(ws.inviteCode))));
    const sent = emails.filter((_, i) => results[i].status === "fulfilled");
    const failed = emails.filter((e) => !sent.includes(e));
    if (sent.length) {
      await WorkspaceModel.updateOne(
        { _id: ws._id },
        { $set: { "invitations.$[i].sentAt": new Date() }, $inc: { "invitations.$[i].sendCount": 1 } },
        { arrayFilters: [{ "i.email": { $in: sent } }] },
      );
      log.info({ id: ws.id, sent }, "📧 Invitation emails sent");
    }
    if (failed.length) {
      const reasons = results.flatMap((r) => (r.status === "rejected" ? [String((r.reason as Error)?.message ?? r.reason)] : []));
      log.error({ id: ws.id, failed, reasons }, "❌ Some invitation emails failed");
    }
    return { sent, failed };
  }

  /** Invite more people after onboarding. Already-invited and existing members are skipped. */
  app.post<{ Params: { id: string }; Body: { emails: string[] } }>(
    "/:id/invitations",
    {
      schema: {
        body: {
          type: "object",
          required: ["emails"],
          additionalProperties: false,
          properties: { emails: { type: "array", minItems: 1, maxItems: LIMITS.invitations, items: { type: "string", maxLength: 254 } } },
        },
      },
    },
    async (req, reply) => {
      const found = await managed(req.params.id, req, reply, "Invite people");
      if (!found) return;
      const { ws, me } = found;
      if (!codeIsActive(ws)) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "❌ Invitations not sent: invite code is revoked or expired");
        return reply.code(409).send({ message: "The invite code is turned off or expired. Turn it back on or make a new one first." });
      }
      const emails = [...new Set(req.body.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const bad = emails.filter((e) => !EMAIL_RE.test(e));
      if (bad.length) {
        req.log.warn({ id: ws.id, by: req.user!.email, bad: bad.length }, "❌ Invitations rejected: invalid emails");
        return reply.code(400).send({
          message: "Invalid email addresses.",
          errors: { emails: `${bad.length === 1 ? `“${bad[0]}” doesn't` : `${bad.length} entries don't`} look like email addresses.` },
        });
      }
      // Who's already here: members (by their account email) and pending invitations.
      const memberEmails = new Set(
        (await UserModel.find({ _id: { $in: ws.members.map((m) => m.userId) } }, { email: 1 })).map((u) => u.email),
      );
      const pending = new Set(ws.invitations.map((i) => i.email));
      const skipped = emails.flatMap((email) =>
        memberEmails.has(email) ? [{ email, reason: "already a member" }] : pending.has(email) ? [{ email, reason: "already invited" }] : [],
      );
      const fresh = emails.filter((e) => !memberEmails.has(e) && !pending.has(e));
      if (ws.invitations.length + fresh.length > MAX_PENDING) {
        req.log.warn({ id: ws.id, pending: ws.invitations.length, adding: fresh.length }, "❌ Invitations rejected: too many pending");
        return reply.code(400).send({ message: `A workspace can have at most ${MAX_PENDING} pending invitations. Cancel some first.` });
      }
      if (fresh.length && !inviteLimit(req.user!.id)) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "⛔ Invitations rate-limited");
        return reply.code(429).send({ message: "That's a lot of invitations. Wait a bit and try again." });
      }
      if (fresh.length) {
        const now = new Date();
        // Only if none of them was added meanwhile (two tabs inviting at once), so nobody is listed twice.
        const res = await WorkspaceModel.updateOne(
          { _id: ws._id, "invitations.email": { $nin: fresh } },
          { $push: { invitations: { $each: fresh.map((email) => ({ email, invitedAt: now, sendCount: 0 })) } } },
        );
        if (!res.modifiedCount) {
          req.log.warn({ id: ws.id, by: req.user!.email }, "⚠️  Invitations lost a race: someone invited them meanwhile");
          return reply.code(409).send({ message: "Invitations just changed. Refresh and try again." });
        }
        req.log.info({ id: ws.id, by: req.user!.email, added: fresh, skipped }, "✉️  Invitations saved to MongoDB");
      } else req.log.info({ id: ws.id, by: req.user!.email, skipped }, "ℹ️  No new invitations — everyone was already invited or a member");

      const { sent, failed } = fresh.length ? await sendInvites(ws, fresh, me.displayName, req.log) : { sent: [], failed: [] };
      const updated = (await WorkspaceModel.findById(ws._id))!;
      return reply.code(fresh.length ? 201 : 200).send({ added: fresh, skipped, sent: sent.length, failed: failed.length, invitations: invitationsView(updated) });
    },
  );

  /** Send an invitation email again. */
  app.post<{ Params: { id: string }; Body: { email: string } }>(
    "/:id/invitations/resend",
    { schema: { body: { type: "object", required: ["email"], additionalProperties: false, properties: { email: { type: "string", maxLength: 254 } } } } },
    async (req, reply) => {
      const found = await managed(req.params.id, req, reply, "Resend invitation");
      if (!found) return;
      const { ws, me } = found;
      const email = req.body.email.trim().toLowerCase();
      const inv = ws.invitations.find((i) => i.email === email);
      if (!inv) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "❌ Resend failed: no such invitation");
        return reply.code(404).send({ message: "That invitation doesn't exist any more." });
      }
      if (!codeIsActive(ws)) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "❌ Resend refused: invite code is revoked or expired");
        return reply.code(409).send({ message: "The invite code is turned off or expired. Turn it back on or make a new one first." });
      }
      const wait = (inv.sentAt?.getTime() ?? 0) + RESEND_COOLDOWN_MS - Date.now();
      if (wait > 0) {
        req.log.info({ id: ws.id, email, waitSeconds: Math.ceil(wait / 1000) }, "⏳ Resend refused: sent moments ago");
        return reply.code(429).send({ message: `It was just sent. Try again in ${Math.ceil(wait / 1000)}s.` });
      }
      if (!inviteLimit(req.user!.id)) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "⛔ Resend rate-limited");
        return reply.code(429).send({ message: "That's a lot of invitations. Wait a bit and try again." });
      }
      const { sent } = await sendInvites(ws, [email], me.displayName, req.log);
      if (!sent.length) return reply.code(502).send({ message: "We couldn't send the email. Try again in a moment." });
      req.log.info({ id: ws.id, by: req.user!.email, email, times: (inv.sendCount ?? 0) + 1 }, "🔁 Invitation resent");
      const updated = (await WorkspaceModel.findById(ws._id))!;
      return reply.send({ invitations: invitationsView(updated) });
    },
  );

  /** Cancel a pending invitation. */
  app.delete<{ Params: { id: string; email: string } }>("/:id/invitations/:email", async (req, reply) => {
    const found = await managed(req.params.id, req, reply, "Cancel invitation");
    if (!found) return;
    const { ws } = found;
    const email = req.params.email.trim().toLowerCase();
    // Match the invitation in the filter: the updatedAt timestamp would otherwise count as a change.
    const res = await WorkspaceModel.updateOne({ _id: ws._id, "invitations.email": email }, { $pull: { invitations: { email } } });
    if (!res.modifiedCount) {
      req.log.warn({ id: ws.id, by: req.user!.email }, "❌ Cancel failed: no such invitation");
      return reply.code(404).send({ message: "That invitation doesn't exist any more." });
    }
    req.log.info({ id: ws.id, by: req.user!.email, email }, "🗑️  Invitation cancelled — removed from MongoDB");
    const updated = (await WorkspaceModel.findById(ws._id))!;
    return reply.send({ invitations: invitationsView(updated) });
  });

  /* ───────────── Members ───────────── */

  /**
   * Email a member about a change to their membership. The change is already saved,
   * so a failed email is logged and never fails the request.
   */
  async function notify(userId: unknown, what: string, log: typeof app.log, send: (to: string, name: string) => Promise<void>) {
    try {
      const user = await UserModel.findById(userId, { email: 1, fullName: 1 });
      if (!user) return log.warn({ what }, "⚠️  No email sent: account not found");
      await send(user.email, user.fullName);
      log.info({ to: user.email, what }, "📧 Notification email sent");
    } catch (err) {
      log.error({ what, err: (err as Error)?.message ?? String(err) }, "❌ Notification email failed");
    }
  }

  /** Remove someone. Owners remove anyone but themselves; admins remove plain members. */
  app.delete<{ Params: { id: string; memberId: string } }>("/:id/members/:memberId", async (req, reply) => {
    const found = await managed(req.params.id, req, reply, "Remove member");
    if (!found) return;
    const { ws, me } = found;
    const target = ws.members.find((m) => mid(m) === req.params.memberId);
    if (!target) return reply.code(404).send({ message: "That person isn't in this workspace any more." });
    if (mid(target) === mid(me)) {
      return reply.code(400).send({ message: me.role === "owner" ? "Owners can't remove themselves. Transfer ownership or delete the workspace." : "Use “Leave workspace” to leave." });
    }
    if (!canRemove(me.role, target.role)) {
      req.log.warn({ id: ws.id, by: req.user!.email, role: me.role, target: target.displayName, targetRole: target.role }, "⛔ Remove rejected: not allowed for that role");
      return reply.code(403).send({ message: target.role === "owner" ? "The owner can't be removed." : "Only the owner can remove an admin." });
    }
    await WorkspaceModel.updateOne({ _id: ws._id }, { $pull: { members: { _id: target._id } } });
    // Their wallet may no longer receive the ownership token.
    syncWorkspace(ws._id);
    live.kick(ws.id, mid(target), "You were removed from the workspace");
    req.log.info(
      { id: ws.id, by: req.user!.email, removed: target.displayName, role: target.role, freedDesk: typeof target.desk === "number" ? target.desk + 1 : "none" },
      "👢 Member removed — saved to MongoDB",
    );
    await notify(target.userId, "removed from workspace", req.log, (to, name) => sendRemovedEmail(to, name, ws.name, me.displayName));
    const updated = (await WorkspaceModel.findById(ws._id))!;
    return reply.send({ members: updated.members.map((m) => memberView(m, req.user!.id)) });
  });

  /** Owner: make someone an admin or a plain member. */
  app.patch<{ Params: { id: string; memberId: string }; Body: { role: "admin" | "member" } }>(
    "/:id/members/:memberId",
    { schema: { body: { type: "object", required: ["role"], additionalProperties: false, properties: { role: { type: "string", enum: ["admin", "member"] } } } } },
    async (req, reply) => {
      const found = await managed(req.params.id, req, reply, "Change role", true);
      if (!found) return;
      const { ws } = found;
      const target = ws.members.find((m) => mid(m) === req.params.memberId);
      if (!target) return reply.code(404).send({ message: "That person isn't in this workspace any more." });
      if (target.role === "owner") return reply.code(400).send({ message: "To change the owner, transfer ownership instead." });
      const from = target.role;
      if (from !== req.body.role) {
        await WorkspaceModel.updateOne({ _id: ws._id, "members._id": target._id }, { $set: { "members.$.role": req.body.role } });
        target.role = req.body.role;
      }
      req.log.info({ id: ws.id, by: req.user!.email, member: target.displayName, from, to: req.body.role }, from === req.body.role ? "ℹ️  Role unchanged" : "🎖️  Role changed — saved to MongoDB");
      return reply.send(memberView(target, req.user!.id));
    },
  );

  /** Owner: hand the workspace to another member. The old owner becomes an admin. */
  app.post<{ Params: { id: string }; Body: { memberId: string } }>(
    "/:id/transfer",
    { schema: { body: { type: "object", required: ["memberId"], additionalProperties: false, properties: { memberId: { type: "string", maxLength: 40 } } } } },
    async (req, reply) => {
      const found = await managed(req.params.id, req, reply, "Transfer ownership", true);
      if (!found) return;
      const { ws, me } = found;
      const target = ws.members.find((m) => mid(m) === req.body.memberId);
      if (!target) return reply.code(404).send({ message: "That person isn't in this workspace any more." });
      if (mid(target) === mid(me)) return reply.code(400).send({ message: "You already own this workspace." });
      // Atomic: only if I'm still the owner and they're still here.
      if (!(await handOver(ws, me, target))) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "⚠️  Transfer lost a race: roles changed meanwhile");
        return reply.code(409).send({ message: "Roles just changed. Refresh and try again." });
      }
      req.log.info({ id: ws.id, from: me.displayName, to: target.displayName }, "👑 Ownership transferred — saved to MongoDB");
      // The ownership token follows: to the new owner's wallet, or into custody if they haven't linked one.
      syncWorkspace(ws._id);
      await notify(target.userId, "new owner", req.log, (to, name) => sendOwnershipEmail(to, name, ws.name, me.displayName));
      const updated = (await WorkspaceModel.findById(ws._id))!;
      // Owner sits first: re-check desks in case the order matters for anyone without one.
      await saveDesks(updated, assignDesks(updated), "ownership transferred", req.log);
      return reply.send({ members: updated.members.map((m) => memberView(m, req.user!.id)) });
    },
  );
};
