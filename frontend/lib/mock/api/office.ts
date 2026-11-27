import type { Member, Room, User, Workspace } from "@/lib/types";
import { db } from "../db";
import { CURRENT_USER_ID } from "../data/users";
import { clone, iso, sleep, uid } from "../delay";

export async function listWorkspaces(): Promise<Workspace[]> {
  await sleep();
  return clone(db.workspaces);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  await sleep(150, 300);
  return clone(db.workspaces.find((w) => w.id === id) ?? null);
}

export async function createWorkspace(name: string, color = "#2563eb"): Promise<Workspace> {
  await sleep(500, 900);
  const ws: Workspace = {
    id: uid("w"), name, slug: name.toLowerCase().replace(/\W+/g, "-"),
    icon: name.trim()[0]?.toUpperCase() ?? "W", color, memberIds: [CURRENT_USER_ID], createdAt: iso(),
  };
  db.workspaces.push(ws);
  db.members.push({ userId: CURRENT_USER_ID, workspaceId: ws.id, role: "owner", roomId: null });
  return clone(ws);
}

export async function listRooms(workspaceId: string): Promise<Room[]> {
  await sleep();
  return clone(db.rooms.filter((r) => r.workspaceId === workspaceId));
}

export type MemberWithUser = Member & { user: User };
export async function listMembers(workspaceId: string): Promise<MemberWithUser[]> {
  await sleep();
  return clone(
    db.members
      .filter((m) => m.workspaceId === workspaceId)
      .map((m) => ({ ...m, user: db.users.find((u) => u.id === m.userId)! })),
  );
}

export async function moveToRoom(workspaceId: string, roomId: string | null): Promise<void> {
  await sleep(100, 250);
  const me = db.members.find((m) => m.workspaceId === workspaceId && m.userId === CURRENT_USER_ID);
  if (me) me.roomId = roomId;
}

/** Static ids for generateStaticParams (Electron static export). */
export const staticWorkspaceIds = () => db.workspaces.map((w) => w.id);
export const staticRoomParams = () => db.rooms.map((r) => ({ workspaceId: r.workspaceId, roomId: r.id }));
