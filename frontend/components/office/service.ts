import { API_URL, apiGet, apiPatch, apiPut } from "@/lib/api";
import type { Role } from "@/components/team/service";
import type { LayoutId } from "@/components/onboarding/model";
import type { OfficeConfig } from "./config";
import type { OfficeMap } from "./game/map";
import type { PlayerStatus } from "./game/events";
import type { ServerSeat } from "./game/seating";

/** Office settings saved on the user's account (same keys as the HUD toggles). */
export type Preferences = { sound: boolean; minimap: boolean; nameTag: boolean };

/** What `/api/workspaces/:id/office` returns: the saved, server-generated office. */
export type SavedOffice = {
  workspace: { workspaceId: string; name: string };
  role: Role;
  config: Omit<OfficeConfig, "workspaceId" | "role">;
  office: OfficeMap;
  savedAt?: string;
  /** The viewer's saved status and desk in this workspace. */
  me?: { memberId: string; status: PlayerStatus; desk: number | null; position?: { x: number; y: number } | null };
  preferences?: Preferences;
  /** Who sits at each desk, from MongoDB. */
  seats?: ServerSeat[];
};

export const getMyWorkspaces = () => apiGet<{ workspaces: { workspaceId: string }[] }>("/api/workspaces/mine");

export const getOffice = (workspaceId: string) => apiGet<SavedOffice>(`/api/workspaces/${encodeURIComponent(workspaceId)}/office`);

/** Owner only: the server regenerates the office for the new plan and saves it. */
export const saveStatus = (workspaceId: string, status: PlayerStatus) =>
  apiPatch<{ status: PlayerStatus }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/me/status`, { status });

export const savePreferences = (patch: Partial<Preferences>) => apiPatch<{ preferences: Preferences }>("/api/auth/me/preferences", patch);

export type OfficeChange = { officeLayout?: LayoutId; teamSize?: string; workspaceStyle?: string; officeFeatures?: string[] };

/** Owner only: the server regenerates the office (plan, size, style, furniture) and saves it for everyone. */
export const changeOffice = (workspaceId: string, change: OfficeChange) =>
  apiPut<SavedOffice>(`/api/workspaces/${encodeURIComponent(workspaceId)}/office/plan`, change);

/**
 * Remember where the avatar stands. `keepalive` lets the request finish while
 * the tab closes. Errors are ignored: it's only a convenience.
 */
export function savePosition(workspaceId: string, pos: { x: number; y: number }, officeSavedAt?: string, keepalive = false) {
  return fetch(`${API_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/me/position`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive,
    body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y), officeSavedAt }),
  })
    .then((r) => r.ok)
    .catch(() => false);
}
