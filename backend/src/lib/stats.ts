import type { Member, Ws } from "./workspace.ts";
import { mid } from "./workspace.ts";

/** Things members can count by doing them in the office. */
export const STAT_ACTIONS = { coffee: "coffees", cat: "catPets" } as const;
export type StatAction = keyof typeof STAT_ACTIONS;

/** One focus session counts for at most this long (a tab left on Focusing overnight isn't 12 hours of work). */
export const MAX_FOCUS_MS = 4 * 60 * 60 * 1000;

/** The same member can't count the same thing more than once every few seconds. */
const COOLDOWN_MS = 4000;
const lastAction = new Map<string, number>();

/** Whether this member may count `action` now (and remember that they did). In memory, like the other rate limits. */
export function takeTurn(memberId: string, action: StatAction, now = Date.now()) {
  const k = `${memberId}:${action}`;
  if (now - (lastAction.get(k) ?? 0) < COOLDOWN_MS) return false;
  lastAction.set(k, now);
  if (lastAction.size > 5000) for (const [key, at] of lastAction) if (now - at > COOLDOWN_MS) lastAction.delete(key);
  return true;
}

/** How long the focus session that ends now lasted, capped. 0 if the member isn't focusing. */
export function focusSession(m: Pick<Member, "status" | "statusUpdatedAt">, now = new Date()) {
  if (m.status !== "focusing" || !m.statusUpdatedAt) return 0;
  return Math.max(0, Math.min(MAX_FOCUS_MS, +now - +m.statusUpdatedAt));
}

const minutes = (ms: number) => Math.floor(ms / 60000);

type Counters = { coffees?: number | null; catPets?: number | null; focusMs?: number | null } | null | undefined;

/** Counters as the stats panel shows them; `extraMs` is a focus session still running. */
const countersView = (s: Counters, extraMs = 0) => ({
  coffees: s?.coffees ?? 0,
  catPets: s?.catPets ?? 0,
  focusMinutes: minutes((s?.focusMs ?? 0) + extraMs),
});

/** The office's totals, the viewer's own numbers, and every member's, most focused first. */
export function statsView(ws: Ws, viewer: Member) {
  const now = new Date();
  const running = ws.members.reduce((sum, m) => sum + focusSession(m, now), 0);
  const members = ws.members
    .map((m) => ({
      memberId: mid(m),
      displayName: m.displayName,
      avatarId: m.avatarId,
      focusing: m.status === "focusing",
      you: mid(m) === mid(viewer),
      ...countersView(m.stats, focusSession(m, now)),
    }))
    .sort((a, b) => b.focusMinutes - a.focusMinutes || b.coffees + b.catPets - (a.coffees + a.catPets) || a.displayName.localeCompare(b.displayName));
  return {
    office: countersView(ws.stats, running),
    you: members.find((m) => m.you)!,
    members,
  };
}
