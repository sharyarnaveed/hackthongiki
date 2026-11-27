import { apiGet, apiPatch, apiPut } from "@/lib/api";
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
  role: "owner" | "member";
  config: Omit<OfficeConfig, "workspaceId" | "role">;
  office: OfficeMap;
  savedAt?: string;
  /** The viewer's saved status and desk in this workspace. */
  me?: { memberId: string; status: PlayerStatus; desk: number | null };
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

export const changeOfficePlan = (workspaceId: string, officeLayout: LayoutId, teamSize: string) =>
  apiPut<SavedOffice>(`/api/workspaces/${encodeURIComponent(workspaceId)}/office/plan`, { officeLayout, teamSize });
