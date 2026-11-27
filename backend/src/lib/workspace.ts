import type { FastifyBaseLogger } from "fastify";
import { Types } from "mongoose";
import { WorkspaceModel } from "../models/Workspace.ts";
import { CODE_RE, normalizeCode } from "./onboarding.ts";
import { officeConfigFor } from "./office.ts";
import { seatsFor, type DeskChange } from "./desks.ts";
import { canManage } from "./roles.ts";
import type { AuthUser } from "./session.ts";

export type Ws = InstanceType<typeof WorkspaceModel>;
export type Member = Ws["members"][number];

/** A member's id as a string (Mongoose types `.id` on documents but not on array subdocuments). */
export const mid = (m: { _id: unknown }) => String(m._id);

export const NOT_FOUND = { message: "That workspace doesn't exist, or you're not a member." };
export const BAD_CODE = { message: "That code doesn't match any workspace. Check it with your teammate." };

/** Fields of a workspace that are safe to show to someone holding its invitation code. */
export function publicView(ws: Ws) {
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

/** Whether the workspace's invitation code currently opens it. */
export const codeIsActive = (ws: Ws) => !ws.inviteCodeRevoked && !(ws.inviteCodeExpires && ws.inviteCodeExpires < new Date());

/** Find the workspace an invitation code opens, or null if unknown/revoked/expired. */
export async function findByCode(raw: string) {
  const code = normalizeCode(raw);
  if (!CODE_RE.test(code)) return null;
  const ws = await WorkspaceModel.findOne({ inviteCode: code, inviteCodeRevoked: false });
  if (!ws || !codeIsActive(ws)) return null;
  return ws;
}

/** A workspace the signed-in user belongs to, and their membership — or null (log says why). */
export async function memberWorkspace(id: string, userId: string, log: FastifyBaseLogger) {
  if (!Types.ObjectId.isValid(id)) {
    log.warn({ workspaceId: id }, "❌ Workspace request: not a valid id");
    return null;
  }
  const ws = await WorkspaceModel.findOne({ _id: id, "members.userId": userId });
  if (!ws) {
    log.warn({ workspaceId: id, user: userId }, "❌ Workspace request: not found or not a member");
    return null;
  }
  return { ws, me: ws.members.find((m) => String(m.userId) === userId)! };
}

/** One member as the members panel shows them. Desks are numbered from 1. */
export function memberView(m: Member, viewerUserId: string) {
  return {
    memberId: mid(m),
    displayName: m.displayName,
    avatarId: m.avatarId,
    role: m.role,
    desk: typeof m.desk === "number" ? m.desk + 1 : null,
    status: m.status,
    statusUpdatedAt: m.statusUpdatedAt,
    joinedAt: m.joinedAt,
    lastSeenAt: m.lastSeenAt,
    you: String(m.userId) === viewerUserId,
  };
}

/** Pending invitations, for owners and admins. */
export const invitationsView = (ws: Ws) =>
  ws.invitations.map((i) => ({ email: i.email, sentAt: i.sentAt ?? null, invitedAt: i.invitedAt ?? null, sendCount: i.sendCount ?? (i.sentAt ? 1 : 0) }));

/** The invite code as owners and admins see it. */
export const inviteView = (ws: Ws, format: (c: string) => string) => ({
  code: format(ws.inviteCode),
  expiresAt: ws.inviteCodeExpires ?? null,
  revoked: !!ws.inviteCodeRevoked,
  active: codeIsActive(ws),
});

/** What the office page needs: the workspace, the viewer, and the saved office layout. */
export function officeView(ws: Ws, me: Member, user: AuthUser) {
  const config = officeConfigFor(ws, me);
  const pos = me.position;
  return {
    workspace: publicView(ws),
    role: me.role,
    me: {
      memberId: mid(me),
      status: me.status,
      desk: me.desk ?? null,
      position: pos && typeof pos.x === "number" && typeof pos.y === "number" ? { x: pos.x, y: pos.y } : null,
    },
    preferences: user.preferences,
    seats: seatsFor(ws, user.id, canManage(me.role)),
    // Desk nameplates for invited teammates are for owners and admins (they manage the emails).
    config: { ...config, teammates: canManage(me.role) ? config.teammates : [] },
    office: ws.office,
    savedAt: ws.officeSavedAt,
  };
}

/** Save desk changes made by `assignDesks` without rewriting the whole workspace. */
export async function saveDesks(ws: Ws, changes: DeskChange[], why: string, log: FastifyBaseLogger) {
  if (!changes.length) return;
  await WorkspaceModel.bulkWrite(
    changes.map((c) => ({
      updateOne: { filter: { _id: ws._id, "members._id": c.memberId }, update: { $set: { "members.$.desk": c.to } } },
    })),
  );
  log.info(
    {
      id: ws.id,
      why,
      changes: changes.map((c) => `${c.member}: ${c.from === null ? "none" : `desk ${c.from + 1}`} → ${c.to === null ? "none (office full)" : `desk ${c.to + 1}`}`),
    },
    "🪑 Desk assignments saved to MongoDB",
  );
}

/** Remember when a member last opened the office. */
export async function touch(ws: Ws, me: Member, log: FastifyBaseLogger) {
  const now = new Date();
  await WorkspaceModel.updateOne({ _id: ws._id, "members._id": me._id }, { $set: { "members.$.lastSeenAt": now } });
  me.lastSeenAt = now;
  log.info({ id: ws.id, member: me.displayName, desk: typeof me.desk === "number" ? me.desk + 1 : "none", status: me.status }, "👀 Member opened the office");
}
