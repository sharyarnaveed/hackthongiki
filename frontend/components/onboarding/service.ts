import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { CreatePayload, JoinPayload, WorkspacePreview } from "./model";

export type { WorkspacePreview } from "./model";

/**
 * Service boundary for onboarding — talks to the backend `/api/workspaces` routes.
 * Codes are generated, verified and rate-limited server-side.
 */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "network" | "invalid" | "server"; message: string; fieldErrors: Record<string, string> };

async function call<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const e = err instanceof ApiError ? err : new ApiError("Something went wrong.", 500);
    // Session expired or signed out: send them to sign in, then back here.
    if (e.status === 401 && typeof window !== "undefined") {
      window.location.assign(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
    }
    const error = e.status === 0 ? "network" : e.status < 500 ? "invalid" : "server";
    console.error(`[onboarding] request failed (${e.status || "no response"}): ${e.message}`, e.fieldErrors, e.data);
    return { ok: false, error, message: e.message, fieldErrors: e.fieldErrors ?? {} };
  }
}

export type CreateResult = {
  workspaceId: string;
  memberId: string;
  inviteCode: string;
  invitationsSent: number;
  invitationsFailed: number;
};

/** Creates the workspace and emails any invitations in one request. */
export const createWorkspace = (payload: CreatePayload) => {
  console.info("[onboarding] saving workspace", payload);
  return call(() => apiPost<CreateResult>("/api/workspaces", payload));
};

/** `code` must already be normalized (see `normalizeCode`). */
export const validateInvitationCode = (code: string) =>
  call(() => apiGet<WorkspacePreview>(`/api/workspaces/invitations/${encodeURIComponent(code)}`));

export const joinWorkspace = (payload: JoinPayload) =>
  call(() => apiPost<{ workspaceId: string; memberId: string; workspace: WorkspacePreview }>("/api/workspaces/join", payload));
