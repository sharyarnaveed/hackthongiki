import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type { PlayerStatus } from "@/components/office/game/events";

export type Role = "owner" | "admin" | "member";

/** Owners and admins manage invitations, the invite code and members. */
export const canManage = (role: Role | undefined) => role === "owner" || role === "admin";

/** Whether `actor` may remove `target` (mirrors the server rule). */
export const canRemove = (actor: Role | undefined, target: Role) => target !== "owner" && (actor === "owner" || (actor === "admin" && target === "member"));

export type TeamMember = {
  memberId: string;
  displayName: string;
  avatarId: string;
  role: Role;
  /** Desk number from 1, or null if the office is full. */
  desk: number | null;
  status: PlayerStatus;
  statusUpdatedAt?: string;
  joinedAt?: string;
  lastSeenAt?: string;
  /** In the office right now (connected to the live office). */
  online?: boolean;
  you: boolean;
};

export type Invitation = { email: string; sentAt: string | null; invitedAt: string | null; sendCount: number };
export type InviteCode = { code: string; expiresAt: string | null; revoked: boolean; active: boolean };
/** A desk swap request the viewer sent (outgoing) or must answer (incoming). Desks are numbered from 1. */
export type DeskRequest = {
  requestId: string;
  direction: "incoming" | "outgoing";
  from: { memberId: string; displayName: string; desk: number };
  to: { memberId: string; displayName: string; desk: number };
  createdAt: string;
};
export type MembersResponse = { members: TeamMember[]; invitations?: Invitation[]; deskRequests?: DeskRequest[]; role: Role; desks: number };

const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

export const getMembers = (id: string) => apiGet<MembersResponse>(`${ws(id)}/members`);

/* Your own membership */
export const saveProfile = (id: string, patch: { displayName?: string; avatarId?: string }) =>
  apiPatch<{ memberId: string; displayName: string; avatarId: string }>(`${ws(id)}/me`, patch);
export const takeDesk = (id: string, desk: number) =>
  apiPut<{ desk: number; swappedWith: { memberId: string; displayName: string; desk: number | null } | null }>(`${ws(id)}/me/desk`, { desk });

/* Desk swap requests */
/** Your open swap requests, both the ones you sent and the ones waiting for your answer. */
export const getSwapRequests = (id: string) => apiGet<{ requests: DeskRequest[] }>(`${ws(id)}/desk-requests`);
export const requestSwap = (id: string, memberId: string) => apiPost<{ requestId: string; requests: DeskRequest[] }>(`${ws(id)}/desk-requests`, { memberId });
export const acceptSwap = (id: string, requestId: string) =>
  apiPost<{ desk: number; swappedWith: { memberId: string; displayName: string; desk: number } }>(`${ws(id)}/desk-requests/${encodeURIComponent(requestId)}/accept`, {});
/** Decline a request sent to you, or cancel one you sent. */
export const dropSwap = (id: string, requestId: string) => apiDelete<{ requests: DeskRequest[] }>(`${ws(id)}/desk-requests/${encodeURIComponent(requestId)}`);

/* Invite code */
export const getInvite = (id: string) => apiGet<InviteCode>(`${ws(id)}/invite`);
export const regenerateInvite = (id: string, expiresInDays?: number | null) => apiPost<InviteCode>(`${ws(id)}/invite/regenerate`, expiresInDays === undefined ? {} : { expiresInDays });
export const updateInvite = (id: string, patch: { revoked?: boolean; expiresInDays?: number | null }) => apiPatch<InviteCode>(`${ws(id)}/invite`, patch);

/* Invitations */
export const inviteEmails = (id: string, emails: string[]) =>
  apiPost<{ added: string[]; skipped: { email: string; reason: string }[]; sent: number; failed: number; invitations: Invitation[] }>(`${ws(id)}/invitations`, { emails });
export const resendInvitation = (id: string, email: string) => apiPost<{ invitations: Invitation[] }>(`${ws(id)}/invitations/resend`, { email });
export const cancelInvitation = (id: string, email: string) => apiDelete<{ invitations: Invitation[] }>(`${ws(id)}/invitations/${encodeURIComponent(email)}`);

/* Members */
export const removeMember = (id: string, memberId: string) => apiDelete<{ members: TeamMember[] }>(`${ws(id)}/members/${encodeURIComponent(memberId)}`);
export const setRole = (id: string, memberId: string, role: "admin" | "member") => apiPatch<TeamMember>(`${ws(id)}/members/${encodeURIComponent(memberId)}`, { role });
export const moveMember = (id: string, memberId: string, desk: number) => apiPut<{ desk: number }>(`${ws(id)}/members/${encodeURIComponent(memberId)}/desk`, { desk });
export const transferOwnership = (id: string, memberId: string) => apiPost<{ members: TeamMember[] }>(`${ws(id)}/transfer`, { memberId });

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };
