import type { FastifyPluginAsync } from "fastify";
import { sendInvitationEmail } from "../lib/mailer.ts";
import {
  AVATARS,
  CODE_RE,
  EMAIL_RE,
  FEATURES,
  LAYOUTS,
  LIMITS,
  PURPOSES,
  STYLES,
  TEAM_SIZES,
  formatCode,
  newInviteCode,
  normalizeCode,
  rateLimiter,
} from "../lib/onboarding.ts";
import { buildOffice, officeConfigFor, officeSummary } from "../lib/office.ts";
import { requireAuth, type AuthUser } from "../lib/session.ts";
import { assignDesks, deskIds, seatsFor, type DeskChange } from "../lib/desks.ts";
import { STATUSES, type MemberStatus } from "../lib/status.ts";
import { Types } from "mongoose";
import { WorkspaceModel } from "../models/Workspace.ts";

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
type PlanBody = { officeLayout: string; teamSize: string };
type ProfileBody = { displayName?: string; avatarId?: string };
type StatusBody = { status: MemberStatus };

const enumOf = (list: string[]) => ({ type: "string", enum: list });
const displayName = { type: "string", minLength: 1, maxLength: LIMITS.displayName };

// Brute-forcing codes: 20 code checks/joins per IP per 10 minutes.
const codeLimit = rateLimiter(20, 10 * 60 * 1000);

type Ws = InstanceType<typeof WorkspaceModel>;

/** Fields of a workspace that are safe to show to someone holding its invitation code. */
function publicView(ws: Ws) {
  const owner = ws.members.find((m) => m.role === "owner");
  return {
    workspaceId: ws.id as string,
    name: ws.name,
    description: ws.description,
    invitedBy: owner?.displayName,
    memberCount: ws.members.length,
    purpose: ws.purpose,
    teamSize: ws.teamSize,
    workspaceStyle: ws.style,
    officeLayout: ws.layout,
    officeFeatures: ws.features,
  };
}

/** Find the workspace an invitation code opens, or null if unknown/revoked/expired. */
async function findByCode(raw: string) {
  const code = normalizeCode(raw);
  if (!CODE_RE.test(code)) return null;
  const ws = await WorkspaceModel.findOne({ inviteCode: code, inviteCodeRevoked: false });
  if (!ws || (ws.inviteCodeExpires && ws.inviteCodeExpires < new Date())) return null;
  return ws;
}

const BAD_CODE = { message: "That code doesn't match any workspace. Check it with your teammate." };

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  // Every workspace route needs a signed-in user.
  app.addHook("onRequest", requireAuth);

  /** Workspaces the signed-in user belongs to (used to skip onboarding for returning users). */
  app.get("/mine", async (req) => {
    const list = await WorkspaceModel.find({ "members.userId": req.user!.id }).sort({ updatedAt: -1 });
    return {
      workspaces: list.map((ws) => {
        const me = ws.members.find((m) => String(m.userId) === req.user!.id)!;
        return { ...publicView(ws), role: me.role, memberId: me.id, displayName: me.displayName, avatarId: me.avatarId, status: me.status, lastSeenAt: me.lastSeenAt };
      }),
    };
  });

  /** Save desk changes made by `assignDesks` without rewriting the whole workspace. */
  async function saveDesks(ws: Ws, changes: DeskChange[], why: string) {
    if (!changes.length) return;
    await WorkspaceModel.bulkWrite(
      changes.map((c) => ({
        updateOne: { filter: { _id: ws._id, "members._id": c.memberId }, update: { $set: { "members.$.desk": c.to } } },
      })),
    );
    app.log.info({ id: ws.id, why, changes: changes.map((c) => `${c.member}: ${c.from === null ? "none" : `desk ${c.from + 1}`} → ${c.to === null ? "none (office full)" : `desk ${c.to + 1}`}`) }, "🪑 Desk assignments saved to MongoDB");
  }

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
      const emails = [...new Set(b.invitationEmails.map((e) => e.trim().toLowerCase()))];
      const bad = emails.filter((e) => !EMAIL_RE.test(e));
      if (bad.length) errors.invitationEmails = `${bad.length === 1 ? `“${bad[0]}” doesn't` : `${bad.length} entries don't`} look like email addresses.`;
      if (Object.keys(errors).length) {
        req.log.warn({ user: req.user!.email, errors }, "❌ Workspace not saved: invalid details");
        return reply.code(400).send({ message: "Invalid workspace details.", errors });
      }

      // Retry on the (very unlikely) chance of an invite-code collision.
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
          { $set: { "invitations.$[i].sentAt": new Date() } },
          { arrayFilters: [{ "i.email": { $in: sentEmails } }] },
        );
      }
      if (sentEmails.length < emails.length)
        req.log.error({ id: ws.id, failed: emails.length - sentEmails.length }, "❌ Some invitation emails failed");

      return reply.code(201).send({
        workspaceId: ws.id,
        memberId: ws.members[0].id,
        inviteCode: formatCode(ws.inviteCode),
        invitationsSent: sentEmails.length,
        invitationsFailed: emails.length - sentEmails.length,
      });
    },
  );

  /** Load a workspace the signed-in user belongs to, or reply 404. */
  async function memberWorkspace(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const ws = await WorkspaceModel.findOne({ _id: id, "members.userId": userId });
    if (!ws) {
      app.log.warn({ workspaceId: id, user: userId }, "❌ Office request: workspace not found or not a member");
      return null;
    }
    return { ws, me: ws.members.find((m) => String(m.userId) === userId)! };
  }

  const NOT_FOUND = { message: "That workspace doesn't exist, or you're not a member." };

  /** What the office page needs: the workspace, the viewer, and the saved office layout. */
  function officeView(ws: Ws, me: Ws["members"][number], user: AuthUser) {
    const config = officeConfigFor(ws, me);
    return {
      workspace: publicView(ws),
      role: me.role,
      me: { memberId: me.id as string, status: me.status, desk: me.desk ?? null },
      preferences: user.preferences,
      seats: seatsFor(ws, user.id, me.role === "owner"),
      // Desk nameplates for invited teammates are the owner's to see (they typed the emails).
      config: { ...config, teammates: me.role === "owner" ? config.teammates : [] },
      office: ws.office,
      savedAt: ws.officeSavedAt,
    };
  }

  /** The stored office. Workspaces created before offices were saved get one generated now. */
  app.get<{ Params: { id: string } }>("/:id/office", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id);
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
        await saveDesks(fresh, assignDesks(fresh), "office generated");
        const freshMe = fresh.members.find((m) => m.id === me.id) ?? me;
        await touch(fresh, freshMe);
        return reply.send(officeView(fresh, freshMe, req.user!));
      }
    }
    // Older workspaces (or a plan with fewer desks) may have members without a valid desk.
    await saveDesks(ws, assignDesks(ws), "office opened");
    await touch(ws, me);
    req.log.info(
      { id: ws.id, user: req.user!.email, role: me.role, savedAt: ws.officeSavedAt, ...officeSummary(ws.office) },
      "🏢 Serving saved office",
    );
    return reply.send(officeView(ws, me, req.user!));
  });

  /** Remember when a member last opened the office. */
  async function touch(ws: Ws, me: Ws["members"][number]) {
    const now = new Date();
    await WorkspaceModel.updateOne({ _id: ws._id, "members._id": me._id }, { $set: { "members.$.lastSeenAt": now } });
    me.lastSeenAt = now;
    app.log.info({ id: ws.id, member: me.displayName, desk: me.desk === null || me.desk === undefined ? "none" : me.desk + 1, status: me.status }, "👀 Member opened the office");
  }

  /** Change the floor plan or team size (owner only); the office is regenerated and saved. */
  app.put<{ Params: { id: string }; Body: PlanBody }>(
    "/:id/office/plan",
    {
      schema: {
        body: {
          type: "object",
          required: ["officeLayout", "teamSize"],
          additionalProperties: false,
          properties: { officeLayout: enumOf(LAYOUTS), teamSize: enumOf(TEAM_SIZES) },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") {
        req.log.warn({ id: ws.id, user: req.user!.email }, "⛔ Office plan change rejected: not the owner");
        return reply.code(403).send({ message: "Only the workspace owner can change the office plan." });
      }
      const from = { layout: ws.layout, teamSize: ws.teamSize };
      req.log.info({ id: ws.id, from, to: req.body }, "📐 Changing office plan");
      ws.layout = req.body.officeLayout;
      ws.teamSize = req.body.teamSize;
      ws.office = buildOffice(ws, req.log);
      ws.officeSavedAt = new Date();
      ws.markModified("office");
      // The new plan may have fewer or renumbered desks: re-check everyone's seat before saving.
      const moved = assignDesks(ws);
      await ws.save();
      if (moved.length) req.log.info({ id: ws.id, moved: moved.map((c) => `${c.member} → ${c.to === null ? "none" : `desk ${c.to + 1}`}`) }, "🪑 Desks reassigned for the new plan");
      req.log.info({ id: ws.id, layout: ws.layout, teamSize: ws.teamSize, ...officeSummary(ws.office) }, "✅ New office plan saved to MongoDB");
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
      const found = await memberWorkspace(req.params.id, req.user!.id);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") {
        req.log.warn({ id: ws.id, user: req.user!.email }, "⛔ Workspace edit rejected: not the owner");
        return reply.code(403).send({ message: "Only the workspace owner can edit it." });
      }
      if (req.body.workspaceName !== undefined) {
        const name = req.body.workspaceName.trim();
        if (!name) return reply.code(400).send({ message: "Invalid workspace details.", errors: { workspaceName: "Your office needs a name on the door." } });
        ws.name = name;
      }
      if (req.body.workspaceDescription !== undefined) ws.description = req.body.workspaceDescription.trim();
      await ws.save();
      req.log.info({ id: ws.id, name: ws.name }, "✏️  Workspace updated");
      return reply.send({ ...publicView(ws), role: me.role, memberId: me.id, displayName: me.displayName, avatarId: me.avatarId });
    },
  );

  /** Owner: delete the workspace for everyone. Member: leave it. */
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    if (me.role === "owner") {
      await WorkspaceModel.deleteOne({ _id: ws._id });
      req.log.info({ id: ws.id, name: ws.name, user: req.user!.email }, "🗑️  Workspace deleted");
      return reply.send({ deleted: true });
    }
    await WorkspaceModel.updateOne({ _id: ws._id }, { $pull: { members: { userId: me.userId } } });
    req.log.info({ id: ws.id, user: req.user!.email }, "🚪 Member left workspace");
    return reply.send({ left: true });
  });

  /** Check an invitation code and reveal the workspace it opens. */
  app.get<{ Params: { code: string } }>("/invitations/:code", async (req, reply) => {
    if (!codeLimit(req.ip)) return reply.code(429).send({ message: "Too many tries. Wait a few minutes and try again." });
    const ws = await findByCode(req.params.code);
    if (!ws) {
      req.log.warn("❌ Unknown invitation code");
      return reply.code(404).send(BAD_CODE);
    }
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
      if (!codeLimit(req.ip)) return reply.code(429).send({ message: "Too many tries. Wait a few minutes and try again." });
      const dn = req.body.displayName.trim();
      if (!dn) return reply.code(400).send({ message: "Invalid details.", errors: { displayName: "Tell us what to put on your name tag." } });

      req.log.info({ user: req.user!.email }, "🚪 Join attempt");
      const ws = await findByCode(req.body.invitationCode);
      if (!ws) {
        req.log.warn({ user: req.user!.email }, "❌ Join failed: unknown invitation code");
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
      if (!pushed) req.log.info({ id: updated.id, user: userId }, "ℹ️  Already a member — nothing added");
      if (!pushed) return reply.send({ workspaceId: updated.id, memberId: member.id, workspace: publicView(updated), alreadyMember: true });
      await saveDesks(updated, assignDesks(updated), "member joined");
      req.log.info(
        {
          id: updated.id,
          member: member.id,
          displayName: member.displayName,
          desk: member.desk === null || member.desk === undefined ? "none (office full)" : `desk ${member.desk + 1}`,
          status: member.status,
          usedInvitation: invited,
          members: updated.members.length,
        },
        "👋 Member joined workspace — saved to MongoDB",
      );
      return reply.code(201).send({ workspaceId: updated.id, memberId: member.id, workspace: publicView(updated) });
    },
  );

  /** Everyone in the workspace, with their desk and status. The owner also sees pending invitations. */
  app.get<{ Params: { id: string } }>("/:id/members", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    const members = ws.members.map((m) => ({
      memberId: m.id as string,
      displayName: m.displayName,
      avatarId: m.avatarId,
      role: m.role,
      desk: typeof m.desk === "number" ? m.desk + 1 : null,
      status: m.status,
      statusUpdatedAt: m.statusUpdatedAt,
      joinedAt: m.joinedAt,
      lastSeenAt: m.lastSeenAt,
      you: String(m.userId) === req.user!.id,
    }));
    const invitations = me.role === "owner" ? ws.invitations.map((i) => ({ email: i.email, sentAt: i.sentAt })) : undefined;
    req.log.info({ id: ws.id, user: req.user!.email, members: members.length, invitations: invitations?.length }, "👥 Members listed");
    return reply.send({ members, invitations });
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
      const found = await memberWorkspace(req.params.id, req.user!.id);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      const set: Record<string, string> = {};
      if (req.body.displayName !== undefined) {
        const dn = req.body.displayName.trim();
        if (!dn) return reply.code(400).send({ message: "Invalid details.", errors: { displayName: "Tell us what to put on your name tag." } });
        set["members.$.displayName"] = dn;
      }
      if (req.body.avatarId !== undefined) set["members.$.avatarId"] = req.body.avatarId;
      await WorkspaceModel.updateOne({ _id: ws._id, "members._id": me._id }, { $set: set });
      const from = { displayName: me.displayName, avatarId: me.avatarId };
      req.log.info({ id: ws.id, user: req.user!.email, from, to: req.body }, "🪪 Member profile saved to MongoDB");
      return reply.send({
        memberId: me.id,
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
      const found = await memberWorkspace(req.params.id, req.user!.id);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.status === req.body.status) return reply.send({ status: me.status, statusUpdatedAt: me.statusUpdatedAt });
      const now = new Date();
      await WorkspaceModel.updateOne(
        { _id: ws._id, "members._id": me._id },
        { $set: { "members.$.status": req.body.status, "members.$.statusUpdatedAt": now } },
      );
      req.log.info({ id: ws.id, member: me.displayName, from: me.status, to: req.body.status }, "🟢 Status saved to MongoDB");
      return reply.send({ status: req.body.status, statusUpdatedAt: now });
    },
  );
};
