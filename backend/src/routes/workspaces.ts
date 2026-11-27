import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { sendInvitationEmail } from "../lib/mailer.ts";
import {
  AVATARS,
  EMAIL_RE,
  FEATURES,
  LAYOUTS,
  LIMITS,
  PURPOSES,
  STYLES,
  TEAM_SIZES,
  formatCode,
  newInviteCode,
  rateLimiter,
} from "../lib/onboarding.ts";
import { buildOffice, officeSummary } from "../lib/office.ts";
import { requireAuth } from "../lib/session.ts";
import { assignDesks, deskIds } from "../lib/desks.ts";
import { STATUSES, type MemberStatus } from "../lib/status.ts";
import { isStandingSpot } from "../lib/position.ts";
import { canManage } from "../lib/roles.ts";
import {
  BAD_CODE,
  NOT_FOUND,
  findByCode,
  memberView,
  memberWorkspace,
  mid,
  officeView,
  publicView,
  saveDesks,
  touch,
  invitationsView,
  type Member,
  type Ws,
} from "../lib/workspace.ts";
import { WorkspaceModel } from "../models/Workspace.ts";
import { teamRoutes } from "./team.ts";
import { deskRequestRoutes } from "./deskRequests.ts";
import { deskRequestsView, staleRequests } from "../lib/deskRequests.ts";
import { focusSession } from "../lib/stats.ts";
import { officeLifeRoutes } from "./officeLife.ts";
import { NoticeModel } from "../models/Notice.ts";
import { live } from "../live/hub.ts";
import { deleteMessages, liveRoutes } from "./live.ts";

type CreateBody = {
  displayName: string;
  avatarId: string;
  workspaceName: string;
  workspaceDescription?: string;
  purpose: string;
  teamSize: string;
  workspaceStyle: string;
  officeLayout: string;
  officeFeatures: string[];
  invitationEmails: string[];
};
type JoinBody = { displayName: string; avatarId: string; invitationCode: string };
type PlanBody = { officeLayout?: string; teamSize?: string; workspaceStyle?: string; officeFeatures?: string[] };
type ProfileBody = { displayName?: string; avatarId?: string };
type StatusBody = { status: MemberStatus };
type DeskBody = { desk: number };
type PositionBody = { x: number; y: number; officeSavedAt?: string };

const enumOf = (list: string[]) => ({ type: "string", enum: list });
const displayName = { type: "string", minLength: 1, maxLength: LIMITS.displayName };

// Brute-forcing codes: 20 code checks/joins per IP per 10 minutes.
const codeLimit = rateLimiter(20, 10 * 60 * 1000);

const deskLabel = (d: number | null | undefined) => (typeof d === "number" ? `desk ${d + 1}` : "none");

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  // Every workspace route needs a signed-in user.
  app.addHook("onRequest", requireAuth);

  // Invite code, invitations and member management (owners and admins).
  await app.register(teamRoutes);
  await app.register(deskRequestRoutes);
  // Notice board, office stats and moving furniture.
  await app.register(officeLifeRoutes);
  // Live presence, movement, calls and the workspace chat.
  await app.register(liveRoutes);

  /** Workspaces the signed-in user belongs to (used to skip onboarding for returning users). */
  app.get("/mine", async (req) => {
    const list = await WorkspaceModel.find({ "members.userId": req.user!.id }).sort({ updatedAt: -1 });
    req.log.info({ user: req.user!.email, workspaces: list.length }, "📋 Workspaces listed");
    return {
      workspaces: list.map((ws) => {
        const me = ws.members.find((m) => String(m.userId) === req.user!.id)!;
        return { ...publicView(ws), role: me.role, memberId: mid(me), displayName: me.displayName, avatarId: me.avatarId, status: me.status, lastSeenAt: me.lastSeenAt };
      }),
    };
  });

  /** Create a workspace from the onboarding answers; the creator becomes its owner. */
  app.post<{ Body: CreateBody }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["displayName", "avatarId", "workspaceName", "purpose", "teamSize", "workspaceStyle", "officeLayout"],
          additionalProperties: false,
          properties: {
            displayName,
            avatarId: enumOf(AVATARS),
            workspaceName: { type: "string", minLength: 1, maxLength: LIMITS.workspaceName },
            workspaceDescription: { type: "string", maxLength: LIMITS.workspaceDescription },
            purpose: enumOf(PURPOSES),
            teamSize: enumOf(TEAM_SIZES),
            workspaceStyle: enumOf(STYLES),
            officeLayout: enumOf(LAYOUTS),
            officeFeatures: { type: "array", items: enumOf(FEATURES), uniqueItems: true, default: [] },
            invitationEmails: { type: "array", items: { type: "string", maxLength: 254 }, maxItems: LIMITS.invitations, default: [] },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      req.log.info(
        {
          user: req.user!.email,
          workspaceName: b.workspaceName,
          purpose: b.purpose,
          teamSize: b.teamSize,
          style: b.workspaceStyle,
          layout: b.officeLayout,
          features: b.officeFeatures,
          invitations: b.invitationEmails.length,
        },
        "🏗️  Saving workspace from onboarding",
      );
      const owner = b.displayName.trim();
      const name = b.workspaceName.trim();
      const errors: Record<string, string> = {};
      if (!owner) errors.displayName = "Tell us what to put on your name tag.";
      if (!name) errors.workspaceName = "Your office needs a name on the door.";
      const emails = [...new Set(b.invitationEmails.map((e) => e.trim().toLowerCase()))].filter((e) => e !== req.user!.email);
      const bad = emails.filter((e) => !EMAIL_RE.test(e));
      if (bad.length) errors.invitationEmails = `${bad.length === 1 ? `“${bad[0]}” doesn't` : `${bad.length} entries don't`} look like email addresses.`;
      if (Object.keys(errors).length) {
        req.log.warn({ user: req.user!.email, errors }, "❌ Workspace not saved: invalid details");
        return reply.code(400).send({ message: "Invalid workspace details.", errors });
      }

      const settings = {
        name,
        description: (b.workspaceDescription ?? "").trim(),
        purpose: b.purpose,
        teamSize: b.teamSize,
        style: b.workspaceStyle,
        layout: b.officeLayout,
        features: b.officeFeatures,
      };
      // Generate the office once, here, and store it: every later visit loads this exact layout.
      let office;
      try {
        office = buildOffice({ ...settings, invitations: emails.map((email) => ({ email })) }, req.log);
      } catch (err) {
        req.log.error({ user: req.user!.email, layout: b.officeLayout, err: (err as Error).message, stack: (err as Error).stack }, "❌ Workspace not saved: office generation failed");
        throw err;
      }
      // Retry on the (very unlikely) chance of an invite-code collision.
      let ws;
      for (let attempt = 0; !ws; attempt++) {
        try {
          ws = await WorkspaceModel.create({
            ...settings,
            office,
            officeSavedAt: new Date(),
            inviteCode: newInviteCode(),
            // The owner takes the first desk; status starts at the default.
            members: [{ userId: req.user!.id, displayName: owner, avatarId: b.avatarId, role: "owner", desk: deskIds(office)[0] ?? null, lastSeenAt: new Date() }],
            invitations: emails.map((email) => ({ email })),
          });
        } catch (err) {
          if ((err as { code?: number }).code === 11000 && attempt < 4) {
            req.log.warn({ attempt }, "♻️  Invite code collision, retrying");
            continue;
          }
          req.log.error({ user: req.user!.email, err: (err as Error).message }, "❌ Workspace not saved: MongoDB write failed");
          throw err;
        }
      }
      req.log.info(
        {
          id: ws.id,
          name,
          inviteCode: formatCode(ws.inviteCode),
          members: ws.members.length,
          ownerDesk: ws.members[0].desk === null ? "none" : `desk ${ws.members[0].desk! + 1} of ${deskIds(office).length}`,
          ownerStatus: ws.members[0].status,
          office: `${office.width}×${office.height}, ${office.objects.length} objects`,
        },
        "✅ Workspace saved to MongoDB",
      );

      // Invitations are best effort: the workspace exists even if some emails fail.
      const results = await Promise.allSettled(emails.map((e) => sendInvitationEmail(e, owner, name, formatCode(ws.inviteCode))));
      const sentEmails = emails.filter((_, i) => results[i].status === "fulfilled");
      if (sentEmails.length) {
        await WorkspaceModel.updateOne(
          { _id: ws._id },
          { $set: { "invitations.$[i].sentAt": new Date() }, $inc: { "invitations.$[i].sendCount": 1 } },
          { arrayFilters: [{ "i.email": { $in: sentEmails } }] },
        );
        req.log.info({ id: ws.id, sent: sentEmails }, "📧 Invitation emails sent");
      }
      if (sentEmails.length < emails.length)
        req.log.error(
          { id: ws.id, failed: emails.filter((e) => !sentEmails.includes(e)), reasons: results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : [])) },
          "❌ Some invitation emails failed",
        );

      return reply.code(201).send({
        workspaceId: ws.id,
        memberId: mid(ws.members[0]),
        inviteCode: formatCode(ws.inviteCode),
        invitationsSent: sentEmails.length,
        invitationsFailed: emails.length - sentEmails.length,
      });
    },
  );

  /** The stored office. Workspaces created before offices were saved get one generated now. */
  app.get<{ Params: { id: string } }>("/:id/office", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    if (!ws.office) {
      req.log.info({ id: ws.id, user: req.user!.email }, "🏗️  No saved office yet — generating one");
      const office = buildOffice(ws, req.log);
      // Only fill in a missing office, so two members opening it at once agree on one layout.
      const saved = await WorkspaceModel.findOneAndUpdate(
        { _id: ws._id, office: null },
        { $set: { office, officeSavedAt: new Date() } },
        { returnDocument: "after" },
      );
      const fresh = saved ?? (await WorkspaceModel.findById(ws._id));
      if (fresh) {
        req.log.info(
          { id: ws.id, ...officeSummary(fresh.office), raced: !saved },
          saved ? "✅ Office saved to MongoDB" : "ℹ️  Another member saved the office first — using theirs",
        );
        await saveDesks(fresh, assignDesks(fresh), "office generated", req.log);
        const freshMe = fresh.members.find((m) => mid(m) === mid(me)) ?? me;
        await touch(fresh, freshMe, req.log);
        return reply.send(officeView(fresh, freshMe, req.user!));
      }
    }
    // Older workspaces (or a plan with fewer desks) may have members without a valid desk.
    await saveDesks(ws, assignDesks(ws), "office opened", req.log);
    await touch(ws, me, req.log);
    req.log.info(
      { id: ws.id, user: req.user!.email, role: me.role, savedAt: ws.officeSavedAt, position: me.position ? `${Math.round(me.position.x!)},${Math.round(me.position.y!)}` : "spawn", ...officeSummary(ws.office) },
      "🏢 Serving saved office",
    );
    return reply.send(officeView(ws, me, req.user!));
  });

  /**
   * Change the office (owner only): floor plan, team size, style and/or furniture.
   * The office is regenerated and saved; desks are re-checked and saved positions reset.
   */
  app.put<{ Params: { id: string }; Body: PlanBody }>(
    "/:id/office/plan",
    {
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            officeLayout: enumOf(LAYOUTS),
            teamSize: enumOf(TEAM_SIZES),
            workspaceStyle: enumOf(STYLES),
            officeFeatures: { type: "array", items: enumOf(FEATURES), uniqueItems: true },
          },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") {
        req.log.warn({ id: ws.id, user: req.user!.email, role: me.role }, "⛔ Office change rejected: not the owner");
        return reply.code(403).send({ message: "Only the workspace owner can change the office." });
      }
      const b = req.body;
      const from = { layout: ws.layout, teamSize: ws.teamSize, style: ws.style, features: [...ws.features] };
      const to = {
        layout: b.officeLayout ?? ws.layout,
        teamSize: b.teamSize ?? ws.teamSize,
        style: b.workspaceStyle ?? ws.style,
        features: b.officeFeatures ?? [...ws.features],
      };
      const same = from.layout === to.layout && from.teamSize === to.teamSize && from.style === to.style && [...from.features].sort().join() === [...to.features].sort().join();
      if (same) {
        req.log.info({ id: ws.id }, "ℹ️  Office change: nothing changed — kept the saved office");
        return reply.send(officeView(ws, me, req.user!));
      }
      req.log.info(
        {
          id: ws.id,
          user: req.user!.email,
          changed: Object.fromEntries(
            (Object.keys(to) as (keyof typeof to)[]).filter((k) => String(from[k]) !== String(to[k])).map((k) => [k, { from: from[k], to: to[k] }]),
          ),
        },
        "📐 Changing the office",
      );
      ws.layout = to.layout;
      ws.teamSize = to.teamSize;
      ws.style = to.style;
      ws.features = to.features;
      ws.office = buildOffice(ws, req.log);
      ws.officeSavedAt = new Date();
      ws.markModified("office");
      // The new office has different walls and furniture: saved spots no longer make sense.
      for (const m of ws.members) m.position = null;
      // Desks are renumbered, so pending swap requests point at the wrong desks.
      ws.deskRequests.splice(0);
      // It may also have fewer or renumbered desks: re-check everyone's seat before saving.
      const moved = assignDesks(ws);
      await ws.save();
      if (moved.length) req.log.info({ id: ws.id, moved: moved.map((c) => `${c.member} → ${deskLabel(c.to)}`) }, "🪑 Desks reassigned for the new office");
      req.log.info({ id: ws.id, layout: ws.layout, teamSize: ws.teamSize, style: ws.style, features: ws.features.length, positionsReset: ws.members.length, ...officeSummary(ws.office) }, "✅ New office saved to MongoDB");
      live.officeChanged(ws.id, ws.office as never, { id: mid(me), name: me.displayName });
      return reply.send(officeView(ws, me, req.user!));
    },
  );

  /** Rename a workspace or change its description (owner only). */
  app.patch<{ Params: { id: string }; Body: { workspaceName?: string; workspaceDescription?: string } }>(
    "/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceName: { type: "string", minLength: 1, maxLength: LIMITS.workspaceName },
            workspaceDescription: { type: "string", maxLength: LIMITS.workspaceDescription },
          },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") {
        req.log.warn({ id: ws.id, user: req.user!.email }, "⛔ Workspace edit rejected: not the owner");
        return reply.code(403).send({ message: "Only the workspace owner can edit it." });
      }
      const from = { name: ws.name, description: ws.description };
      if (req.body.workspaceName !== undefined) {
        const name = req.body.workspaceName.trim();
        if (!name) return reply.code(400).send({ message: "Invalid workspace details.", errors: { workspaceName: "Your office needs a name on the door." } });
        ws.name = name;
      }
      if (req.body.workspaceDescription !== undefined) ws.description = req.body.workspaceDescription.trim();
      await ws.save();
      req.log.info({ id: ws.id, from, to: { name: ws.name, description: ws.description } }, "✏️  Workspace updated");
      return reply.send({ ...publicView(ws), role: me.role, memberId: mid(me), displayName: me.displayName, avatarId: me.avatarId });
    },
  );

  /** Owner: delete the workspace for everyone. Anyone else: leave it. */
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    if (me.role === "owner") {
      await WorkspaceModel.deleteOne({ _id: ws._id });
      const notices = await NoticeModel.deleteMany({ workspaceId: ws._id });
      const messages = await deleteMessages(ws._id);
      live.closeSpace(ws.id, "The workspace was deleted");
      req.log.info({ id: ws.id, name: ws.name, user: req.user!.email, members: ws.members.length, notices: notices.deletedCount, messages: messages.deletedCount }, "🗑️  Workspace deleted");
      return reply.send({ deleted: true });
    }
    await WorkspaceModel.updateOne({ _id: ws._id }, { $pull: { members: { userId: me.userId } } });
    live.kick(ws.id, mid(me), "You left the workspace");
    req.log.info({ id: ws.id, user: req.user!.email, role: me.role, freedDesk: deskLabel(me.desk) }, "🚪 Member left workspace");
    return reply.send({ left: true });
  });

  /** Check an invitation code and reveal the workspace it opens. */
  app.get<{ Params: { code: string } }>("/invitations/:code", async (req, reply) => {
    if (!codeLimit(req.ip)) {
      req.log.warn({ ip: req.ip }, "⛔ Invitation code check rate-limited");
      return reply.code(429).send({ message: "Too many tries. Wait a few minutes and try again." });
    }
    const ws = await findByCode(req.params.code);
    if (!ws) {
      req.log.warn({ user: req.user!.email }, "❌ Unknown, revoked or expired invitation code");
      return reply.code(404).send(BAD_CODE);
    }
    req.log.info({ id: ws.id, user: req.user!.email }, "🎟️  Invitation code checked");
    return reply.send(publicView(ws));
  });

  /** Join the workspace an invitation code opens. */
  app.post<{ Body: JoinBody }>(
    "/join",
    {
      schema: {
        body: {
          type: "object",
          required: ["displayName", "avatarId", "invitationCode"],
          additionalProperties: false,
          properties: { displayName, avatarId: enumOf(AVATARS), invitationCode: { type: "string", maxLength: 24 } },
        },
      },
    },
    async (req, reply) => {
      if (!codeLimit(req.ip)) {
        req.log.warn({ ip: req.ip }, "⛔ Join rate-limited");
        return reply.code(429).send({ message: "Too many tries. Wait a few minutes and try again." });
      }
      const dn = req.body.displayName.trim();
      if (!dn) return reply.code(400).send({ message: "Invalid details.", errors: { displayName: "Tell us what to put on your name tag." } });

      req.log.info({ user: req.user!.email }, "🚪 Join attempt");
      const ws = await findByCode(req.body.invitationCode);
      if (!ws) {
        req.log.warn({ user: req.user!.email }, "❌ Join failed: unknown, revoked or expired invitation code");
        return reply.code(404).send(BAD_CODE);
      }

      const userId = req.user!.id;
      // Atomic and idempotent: the filter only matches if this user isn't a member yet,
      // so retries or double clicks never add them twice.
      // An invitation sent to this email is used up: its reserved desk goes to the new member.
      const invited = ws.invitations.some((i) => i.email === req.user!.email);
      const pushed = await WorkspaceModel.findOneAndUpdate(
        { _id: ws._id, "members.userId": { $ne: userId } },
        {
          $push: { members: { userId, displayName: dn, avatarId: req.body.avatarId, role: "member", lastSeenAt: new Date() } },
          $pull: { invitations: { email: req.user!.email } },
        },
        { returnDocument: "after" },
      );
      const updated = pushed ?? (await WorkspaceModel.findById(ws._id));
      if (!updated) return reply.code(404).send(BAD_CODE);
      const member = updated.members.find((m) => String(m.userId) === userId)!;
      if (!pushed) {
        req.log.info({ id: updated.id, user: req.user!.email }, "ℹ️  Already a member — nothing added");
        return reply.send({ workspaceId: updated.id, memberId: mid(member), workspace: publicView(updated), alreadyMember: true });
      }
      await saveDesks(updated, assignDesks(updated), "member joined", req.log);
      req.log.info(
        {
          id: updated.id,
          member: mid(member),
          displayName: member.displayName,
          desk: typeof member.desk === "number" ? `desk ${member.desk + 1}` : "none (office full)",
          status: member.status,
          usedInvitation: invited,
          members: updated.members.length,
        },
        "👋 Member joined workspace — saved to MongoDB",
      );
      return reply.code(201).send({ workspaceId: updated.id, memberId: mid(member), workspace: publicView(updated) });
    },
  );

  /** Everyone in the workspace, with their desk and status. Owners and admins also see pending invitations. */
  app.get<{ Params: { id: string } }>("/:id/members", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    const online = live.online(ws.id);
    const members = ws.members.map((m) => ({ ...memberView(m, req.user!.id), online: online.has(mid(m)) }));
    const invitations = canManage(me.role) ? invitationsView(ws) : undefined;
    // Swap requests go stale when someone moves or leaves; tidy them up here.
    const stale = staleRequests(ws);
    if (stale.length) {
      await WorkspaceModel.updateOne({ _id: ws._id }, { $pull: { deskRequests: { _id: { $in: stale.map((r) => r._id) } } } });
      req.log.info({ id: ws.id, removed: stale.length }, "🧹 Stale desk swap requests removed");
    }
    const deskRequests = deskRequestsView(ws, me);
    req.log.info({ id: ws.id, user: req.user!.email, members: members.length, invitations: invitations?.length, deskRequests: deskRequests.length }, "👥 Members listed");
    return reply.send({ members, invitations, deskRequests, role: me.role, desks: deskIds(ws.office).length });
  });

  /** Change your own name tag or avatar in this workspace. */
  app.patch<{ Params: { id: string }; Body: ProfileBody }>(
    "/:id/me",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { displayName, avatarId: enumOf(AVATARS) },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      const set: Record<string, string> = {};
      if (req.body.displayName !== undefined) {
        const dn = req.body.displayName.trim();
        if (!dn) {
          req.log.warn({ id: ws.id, user: req.user!.email }, "❌ Profile not saved: empty name tag");
          return reply.code(400).send({ message: "Invalid details.", errors: { displayName: "Tell us what to put on your name tag." } });
        }
        set["members.$.displayName"] = dn;
      }
      if (req.body.avatarId !== undefined) set["members.$.avatarId"] = req.body.avatarId;
      await WorkspaceModel.updateOne({ _id: ws._id, "members._id": me._id }, { $set: set });
      const from = { displayName: me.displayName, avatarId: me.avatarId };
      req.log.info({ id: ws.id, user: req.user!.email, from, to: req.body }, "🪪 Member profile saved to MongoDB");
      live.update(ws.id, mid(me), {
        ...(set["members.$.displayName"] ? { name: set["members.$.displayName"] } : {}),
        ...(set["members.$.avatarId"] ? { avatarId: set["members.$.avatarId"] } : {}),
      });
      return reply.send({
        memberId: mid(me),
        displayName: set["members.$.displayName"] ?? me.displayName,
        avatarId: set["members.$.avatarId"] ?? me.avatarId,
      });
    },
  );

  /** Save your status (Available / Focusing / On a break) in this workspace. */
  app.patch<{ Params: { id: string }; Body: StatusBody }>(
    "/:id/me/status",
    {
      schema: {
        body: { type: "object", required: ["status"], additionalProperties: false, properties: { status: enumOf([...STATUSES]) } },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.status === req.body.status) return reply.send({ status: me.status, statusUpdatedAt: me.statusUpdatedAt });
      const now = new Date();
      // Leaving Focusing adds the session to your focus time and the office's.
      const focusMs = focusSession(me, now);
      await WorkspaceModel.updateOne(
        { _id: ws._id, "members._id": me._id },
        {
          $set: { "members.$.status": req.body.status, "members.$.statusUpdatedAt": now },
          ...(focusMs ? { $inc: { "members.$.stats.focusMs": focusMs, "stats.focusMs": focusMs } } : {}),
        },
      );
      req.log.info(
        { id: ws.id, member: me.displayName, from: me.status, to: req.body.status, ...(focusMs ? { focusedMinutes: Math.round(focusMs / 60000) } : {}) },
        "🟢 Status saved to MongoDB",
      );
      live.update(ws.id, mid(me), { status: req.body.status });
      return reply.send({ status: req.body.status, statusUpdatedAt: now });
    },
  );

  /**
   * Move to another desk (numbered from 1). Anyone can take an open desk; owners and
   * admins can also take an occupied one, swapping with whoever sits there.
   */
  app.put<{ Params: { id: string }; Body: DeskBody }>(
    "/:id/me/desk",
    { schema: { body: { type: "object", required: ["desk"], additionalProperties: false, properties: { desk: { type: "integer", minimum: 1 } } } } },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      return moveToDesk(ws, me, req.body.desk - 1, canManage(me.role), req.user!.email, req, reply);
    },
  );

  /** Owners and admins: move any member to a desk, swapping if it's taken. */
  app.put<{ Params: { id: string; memberId: string }; Body: DeskBody }>(
    "/:id/members/:memberId/desk",
    { schema: { body: { type: "object", required: ["desk"], additionalProperties: false, properties: { desk: { type: "integer", minimum: 1 } } } } },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (!canManage(me.role)) {
        req.log.warn({ id: ws.id, user: req.user!.email, role: me.role }, "⛔ Desk move rejected: not an owner or admin");
        return reply.code(403).send({ message: "Only owners and admins can move other people." });
      }
      const target = ws.members.find((m) => mid(m) === req.params.memberId);
      if (!target) return reply.code(404).send({ message: "That person isn't in this workspace any more." });
      return moveToDesk(ws, target, req.body.desk - 1, true, req.user!.email, req, reply);
    },
  );

  async function moveToDesk(
    ws: Ws,
    who: Member,
    desk: number,
    maySwap: boolean,
    by: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (!deskIds(ws.office).includes(desk)) {
      req.log.warn({ id: ws.id, by, desk: desk + 1 }, "❌ Desk change rejected: no such desk");
      return reply.code(400).send({ message: `This office has no desk ${desk + 1}.` });
    }
    const from = typeof who.desk === "number" ? who.desk : null;
    if (from === desk) return reply.send({ memberId: mid(who), desk: desk + 1, swappedWith: null });
    const sitter = ws.members.find((m) => m.desk === desk && mid(m) !== mid(who));

    if (!sitter) {
      // Only succeeds if nobody took the desk in the meantime.
      const res = await WorkspaceModel.updateOne(
        { _id: ws._id, members: { $not: { $elemMatch: { desk } } } },
        { $set: { "members.$[m].desk": desk } },
        { arrayFilters: [{ "m._id": who._id }] },
      );
      if (!res.modifiedCount) {
        req.log.warn({ id: ws.id, by, desk: desk + 1 }, "⚠️  Desk change lost a race: someone just took it");
        return reply.code(409).send({ message: `Someone just took desk ${desk + 1}. Pick another.` });
      }
      req.log.info({ id: ws.id, by, member: who.displayName, from: deskLabel(from), to: deskLabel(desk) }, "🪑 Desk changed — saved to MongoDB");
      return reply.send({ memberId: mid(who), desk: desk + 1, swappedWith: null });
    }

    if (!maySwap) {
      req.log.warn({ id: ws.id, by, desk: desk + 1, sitter: sitter.displayName }, "⛔ Desk change rejected: desk taken");
      return reply.code(409).send({ message: `Desk ${desk + 1} is ${sitter.displayName}'s. Ask them to swap from the members panel.` });
    }
    // Swap, but only if neither of them moved in the meantime.
    const res = await WorkspaceModel.updateOne(
      {
        _id: ws._id,
        members: { $all: [{ $elemMatch: { _id: who._id, desk: from } }, { $elemMatch: { _id: sitter._id, desk } }] },
      },
      { $set: { "members.$[a].desk": desk, "members.$[b].desk": from } },
      { arrayFilters: [{ "a._id": who._id }, { "b._id": sitter._id }] },
    );
    if (!res.modifiedCount) {
      req.log.warn({ id: ws.id, by, desk: desk + 1 }, "⚠️  Desk swap lost a race: desks changed meanwhile");
      return reply.code(409).send({ message: "Desks just changed. Refresh and try again." });
    }
    req.log.info(
      { id: ws.id, by, swapped: [`${who.displayName}: ${deskLabel(from)} → ${deskLabel(desk)}`, `${sitter.displayName}: ${deskLabel(desk)} → ${deskLabel(from)}`] },
      "🔁 Desks swapped — saved to MongoDB",
    );
    return reply.send({ memberId: mid(who), desk: desk + 1, swappedWith: { memberId: mid(sitter), displayName: sitter.displayName, desk: from === null ? null : from + 1 } });
  }

  /** Remember where your avatar is standing, so the next visit starts there. */
  app.put<{ Params: { id: string }; Body: PositionBody }>(
    "/:id/me/position",
    {
      schema: {
        body: {
          type: "object",
          required: ["x", "y"],
          additionalProperties: false,
          properties: { x: { type: "number" }, y: { type: "number" }, officeSavedAt: { type: "string", maxLength: 40 } },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      const { x, y, officeSavedAt } = req.body;
      // A tab still showing the previous office mustn't drop you inside a wall of the new one.
      if (officeSavedAt && ws.officeSavedAt && +new Date(officeSavedAt) !== +ws.officeSavedAt) {
        req.log.info({ id: ws.id, member: me.displayName }, "ℹ️  Position ignored: sent for an older version of the office");
        return reply.code(409).send({ message: "The office changed since you opened it." });
      }
      if (!isStandingSpot(ws.office, x, y)) {
        req.log.warn({ id: ws.id, member: me.displayName, x, y }, "❌ Position rejected: outside the office or inside a wall");
        return reply.code(400).send({ message: "That spot isn't inside the office." });
      }
      const position = { x: Math.round(x), y: Math.round(y), savedAt: new Date() };
      await WorkspaceModel.updateOne({ _id: ws._id, "members._id": me._id }, { $set: { "members.$.position": position } });
      req.log.info({ id: ws.id, member: me.displayName, at: `${position.x},${position.y}` }, "📍 Position saved to MongoDB");
      return reply.send({ position: { x: position.x, y: position.y } });
    },
  );
};
