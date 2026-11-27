import type { Member, Room, Workspace } from "@/lib/types";
import { iso } from "../delay";

export const workspaces: Workspace[] = [
  { id: "w1", name: "Acme Studio", slug: "acme", icon: "A", color: "#2563eb", memberIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"], createdAt: iso(320) },
  { id: "w2", name: "Side Project Co.", slug: "side", icon: "S", color: "#0d9488", memberIds: ["u1", "u3", "u5", "u8"], createdAt: iso(45) },
];

/** 3 rooms per workspace; x/y/w/h on a 24×14 floor grid. */
export const rooms: Room[] = [
  { id: "r1", workspaceId: "w1", name: "Main Hall", kind: "open", capacity: 20, x: 1, y: 1, w: 12, h: 7 },
  { id: "r2", workspaceId: "w1", name: "Boardroom", kind: "meeting", capacity: 12, x: 14, y: 1, w: 9, h: 6 },
  { id: "r3", workspaceId: "w1", name: "Quiet Corner", kind: "focus", capacity: 4, x: 14, y: 8, w: 9, h: 5 },
  { id: "r4", workspaceId: "w2", name: "Lounge", kind: "lounge", capacity: 8, x: 1, y: 1, w: 10, h: 6 },
  { id: "r5", workspaceId: "w2", name: "Standup Room", kind: "meeting", capacity: 6, x: 12, y: 1, w: 11, h: 6 },
  { id: "r6", workspaceId: "w2", name: "Deep Work", kind: "focus", capacity: 3, x: 1, y: 8, w: 22, h: 5 },
];

export const members: Member[] = [
  { userId: "u1", workspaceId: "w1", role: "owner", roomId: "r1" },
  { userId: "u2", workspaceId: "w1", role: "admin", roomId: "r2" },
  { userId: "u3", workspaceId: "w1", role: "member", roomId: "r2" },
  { userId: "u4", workspaceId: "w1", role: "member", roomId: null },
  { userId: "u5", workspaceId: "w1", role: "member", roomId: "r1" },
  { userId: "u6", workspaceId: "w1", role: "member", roomId: "r3" },
  { userId: "u7", workspaceId: "w1", role: "member", roomId: null },
  { userId: "u8", workspaceId: "w1", role: "member", roomId: "r1" },
  { userId: "u1", workspaceId: "w2", role: "owner", roomId: null },
  { userId: "u3", workspaceId: "w2", role: "admin", roomId: "r4" },
  { userId: "u5", workspaceId: "w2", role: "member", roomId: "r6" },
  { userId: "u8", workspaceId: "w2", role: "member", roomId: "r4" },
];
