/** A member's status in a workspace (mirrors frontend PlayerStatus). */
export const STATUSES = ["available", "focusing", "break"] as const;
export type MemberStatus = (typeof STATUSES)[number];
export const DEFAULT_STATUS: MemberStatus = "available";
