import { mid, type Member, type Ws } from "./workspace.ts";

/**
 * Desk swap requests between members. A request records both desks as they were
 * when it was made; if either person has moved (or left) since, it's stale and
 * is never shown or accepted.
 */

export type DeskRequest = Ws["deskRequests"][number];

/** Each member can have this many requests waiting at once. */
export const MAX_OUTGOING = 3;

const byId = (ws: Ws, id: unknown) => ws.members.find((m) => mid(m) === String(id));

/** The two members of a request, or null if it no longer matches who sits where. */
export function liveRequest(ws: Ws, r: DeskRequest): { from: Member; to: Member } | null {
  const from = byId(ws, r.from);
  const to = byId(ws, r.to);
  if (!from || !to || from.desk !== r.fromDesk || to.desk !== r.toDesk) return null;
  return { from, to };
}

/** Requests that went out of date, for cleaning up. */
export const staleRequests = (ws: Ws) => ws.deskRequests.filter((r) => !liveRequest(ws, r));

/** The viewer's own requests: ones they sent and ones waiting for their answer. Desks are numbered from 1. */
export function deskRequestsView(ws: Ws, me: Member) {
  const mine = mid(me);
  return ws.deskRequests.flatMap((r) => {
    const live = liveRequest(ws, r);
    if (!live) return [];
    const direction = mid(live.from) === mine ? "outgoing" : mid(live.to) === mine ? "incoming" : null;
    if (!direction) return [];
    return [
      {
        requestId: String(r._id),
        direction,
        from: { memberId: mid(live.from), displayName: live.from.displayName, desk: r.fromDesk + 1 },
        to: { memberId: mid(live.to), displayName: live.to.displayName, desk: r.toDesk + 1 },
        createdAt: r.createdAt,
      },
    ];
  });
}

/** A $pull condition removing every request that involves any of these members. */
export const involving = (memberIds: unknown[]) => ({ $or: [{ from: { $in: memberIds } }, { to: { $in: memberIds } }] });
