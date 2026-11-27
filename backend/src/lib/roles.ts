/** Workspace roles, from most to least powerful. */
export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/** Owners and admins manage invitations, the invite code and (non-admin) members. */
export const canManage = (role: string | null | undefined) => role === "owner" || role === "admin";

/** Whether `actor` may remove `target` from the workspace. */
export function canRemove(actor: string | null | undefined, target: string | null | undefined) {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target === "member";
}
