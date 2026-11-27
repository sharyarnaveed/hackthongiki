import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type { FurnitureMove } from "./game/layoutEdit";

/** Office life: the notice board, small stats and saving moved furniture. */

const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

export const NOTE_COLORS = ["sun", "sage", "terracotta", "paper"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export type Notice = { noticeId: string; text: string; color: NoteColor; pinned: boolean; authorName: string; createdAt: string; updatedAt: string };
export type NoticesResponse = { notices: Notice[]; canEdit: boolean; max: number };
export type NoticeDraft = { text?: string; color?: NoteColor; pinned?: boolean };

export const getNotices = (id: string) => apiGet<NoticesResponse>(`${ws(id)}/notices`);
export const addNotice = (id: string, note: NoticeDraft & { text: string }) => apiPost<{ notice: Notice; notices: Notice[] }>(`${ws(id)}/notices`, note);
export const updateNotice = (id: string, noticeId: string, patch: NoticeDraft) =>
  apiPatch<{ notice: Notice; notices: Notice[] }>(`${ws(id)}/notices/${encodeURIComponent(noticeId)}`, patch);
export const deleteNotice = (id: string, noticeId: string) => apiDelete<{ deleted: true; notices: Notice[] }>(`${ws(id)}/notices/${encodeURIComponent(noticeId)}`);

export type Counters = { coffees: number; catPets: number; focusMinutes: number };
export type MemberStats = Counters & { memberId: string; displayName: string; avatarId: string; focusing: boolean; you: boolean };
export type StatsResponse = { office: Counters; you: MemberStats; members: MemberStats[] };
export type StatAction = "coffee" | "cat";

export const getStats = (id: string) => apiGet<StatsResponse>(`${ws(id)}/stats`);
/** Count a coffee or a cat pet. `counted` is false for a repeat within a few seconds. */
export const countStat = (id: string, action: StatAction) => apiPost<StatsResponse & { counted: boolean }>(`${ws(id)}/me/stats`, { action });

/** Owner: save furniture moved in arrange mode. */
export const saveLayout = (id: string, moves: FurnitureMove[], officeSavedAt?: string) =>
  apiPut<{ moved: number; layoutVersion: number }>(`${ws(id)}/office/layout`, { moves, officeSavedAt });

/** "1h 25m", "12m", "0m". */
export function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
