import { nameFromEmail } from "@/components/office/game/seating";
import type { WorkspaceModel } from "../models/Workspace.ts";

/**
 * Who sits where, stored in MongoDB. Each member keeps one desk (the office
 * map's 0-based desk index) across visits and devices. Invited teammates who
 * haven't joined yet are shown on the next free desks, but nothing is stored
 * for them until they join.
 */

type Ws = InstanceType<typeof WorkspaceModel>;

/** A desk as the office shows it to one viewer. `at` is the map's desk index. */
export type SeatView =
  | { at: number; kind: "mine" | "member"; name: string }
  | { at: number; kind: "invited"; name: string }
  | { at: number; kind: "open" };

export type DeskChange = { memberId: string; member: string; from: number | null; to: number | null };

/** The desk indexes the saved office has, lowest first. */
export function deskIds(office: { objects?: { desk?: number }[] } | null | undefined): number[] {
  const ids = new Set<number>();
  for (const o of office?.objects ?? []) if (typeof o.desk === "number") ids.add(o.desk);
  return [...ids].sort((a, b) => a - b);
}

/**
 * Give every member a unique desk that exists in the office: valid desks are
 * kept, everyone else gets the lowest free one (owner first, then by join date).
 * Mutates `ws.members` and returns what changed, for the logs.
 */
export function assignDesks(ws: Ws): DeskChange[] {
  const ids = deskIds(ws.office);
  const valid = new Set(ids);
  const taken = new Set<number>();
  const rank = (m: Ws["members"][number]) => (m.role === "owner" ? 0 : 1);
  const order = [...ws.members].sort((a, b) => rank(a) - rank(b) || +new Date(a.joinedAt ?? 0) - +new Date(b.joinedAt ?? 0));
  const waiting: typeof order = [];
  for (const m of order) {
    if (typeof m.desk === "number" && valid.has(m.desk) && !taken.has(m.desk)) taken.add(m.desk);
    else waiting.push(m);
  }
  const changes: DeskChange[] = [];
  for (const m of waiting) {
    const free = ids.find((d) => !taken.has(d)) ?? null;
    if (free !== null) taken.add(free);
    const from = typeof m.desk === "number" ? m.desk : null;
    if (from !== free) {
      changes.push({ memberId: String(m._id), member: m.displayName, from, to: free });
      m.desk = free;
    }
  }
  return changes;
}

/** The office's desks for one viewer. Invitees' names are only shown to the owner, who typed the emails. */
export function seatsFor(ws: Ws, viewerUserId: string, showInviteNames: boolean): SeatView[] {
  const byDesk = new Map(ws.members.filter((m) => typeof m.desk === "number").map((m) => [m.desk as number, m]));
  const pending = ws.invitations.map((i) => i.email);
  return deskIds(ws.office).map((at): SeatView => {
    const m = byDesk.get(at);
    if (m) return { at, kind: String(m.userId) === viewerUserId ? "mine" : "member", name: m.displayName };
    const email = pending.shift();
    if (email) return { at, kind: "invited", name: showInviteNames ? nameFromEmail(email) : "Invited" };
    return { at, kind: "open" };
  });
}
