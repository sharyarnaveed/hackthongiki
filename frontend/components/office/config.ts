import { DEFAULT_AVATAR, isAvatarId, type AvatarId } from "@/components/onboarding/avatars";
import { isFeatureId, type FeatureId } from "./features";
import type { ServerSeat } from "./game/seating";
import type { PlayerStatus } from "./game/events";
import type { Preferences } from "./service";
import {
  DEFAULT_LAYOUT,
  DEFAULT_STYLE,
  DEFAULT_TEAM_SIZE,
  LIMITS,
  PURPOSES,
  STYLES,
  TEAM_SIZES,
  isLayoutId,
  type LayoutId,
  type StyleId,
} from "@/components/onboarding/model";

/**
 * Input for the office generator. Offices are always saved workspaces: the
 * server builds this from the workspace stored in MongoDB and sends it with
 * the saved map. Field names mirror the workspace/onboarding answers.
 */
export interface OfficeConfig {
  displayName: string;
  avatarId: AvatarId;
  workspaceName: string;
  workspaceDescription: string;
  workspaceStyle: StyleId;
  purpose: string;
  teamSize: string;
  /** Floor-plan template (`officeLayout`). */
  layout: LayoutId;
  /** Furniture ticked during onboarding; null means everything the plan has room for. */
  features: FeatureId[] | null;
  /** First names of teammates who need desks (joined members and pending invitations). */
  teammates: string[];
  /** Set once the office is loaded from the server. */
  workspaceId?: string;
  role?: "owner" | "member";
  /** Desks, status and settings as stored on the server. */
  seats?: ServerSeat[];
  status?: PlayerStatus;
  preferences?: Preferences;
}

/** The workspace opened in this tab; its saved office is loaded from the server. */
const WORKSPACE_KEY = "pixel-office:workspace";

/**
 * Map any style value — ids, labels, or loose variants — to a supported style.
 * The single place where style strings are interpreted.
 */
export function normalizeStyle(value: unknown): StyleId {
  if (typeof value !== "string") return DEFAULT_STYLE;
  const v = value.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  for (const s of STYLES) if (v === s.id.replace("-", " ") || v === s.label.toLowerCase()) return s.id;
  if (/green|cozy|cosy/.test(v)) return "cozy-green";
  if (/creative|studio/.test(v)) return "creative-studio";
  if (/quiet|minimal/.test(v)) return "quiet-minimal";
  if (/community|lounge|social/.test(v)) return "community-lounge";
  return DEFAULT_STYLE;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = (v: unknown, list: readonly { id: string }[]) => (typeof v === "string" && list.some((o) => o.id === v) ? v : "");

/** Validate untrusted input (a server response or workspace answers) into a config. Returns null if unusable. */
export function toOfficeConfig(raw: unknown): OfficeConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const workspaceName = str(r.workspaceName, LIMITS.workspaceName);
  if (!workspaceName) return null;
  return {
    displayName: str(r.displayName, LIMITS.displayName),
    avatarId: typeof r.avatarId === "string" && isAvatarId(r.avatarId) ? r.avatarId : DEFAULT_AVATAR,
    workspaceName,
    workspaceDescription: str(r.workspaceDescription, LIMITS.workspaceDescription),
    workspaceStyle: normalizeStyle(r.workspaceStyle),
    purpose: oneOf(r.purpose, PURPOSES),
    teamSize: oneOf(r.teamSize, TEAM_SIZES),
    layout: isLayoutId(r.officeLayout) ? r.officeLayout : DEFAULT_LAYOUT,
    features: Array.isArray(r.officeFeatures) ? r.officeFeatures.filter(isFeatureId) : null,
    teammates: Array.isArray(r.teammates) ? r.teammates.map((n) => str(n, 16)).filter(Boolean).slice(0, LIMITS.invitations) : [],
  };
}

/**
 * A config for asking the generator what a floor plan has room for (the
 * onboarding feature picker). Not a real office: nothing here is shown as data.
 */
export function planConfig(layout: string, teamSize: string): OfficeConfig {
  return {
    displayName: "",
    avatarId: DEFAULT_AVATAR,
    workspaceName: "plan",
    workspaceDescription: "",
    workspaceStyle: DEFAULT_STYLE,
    purpose: "",
    teamSize: oneOf(teamSize, TEAM_SIZES) || DEFAULT_TEAM_SIZE,
    layout: isLayoutId(layout) ? layout : DEFAULT_LAYOUT,
    features: null,
    teammates: [],
  };
}

/** The workspace chosen in this tab, if any. Client-only. */
export function storedWorkspaceId(): string | null {
  try {
    return sessionStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** Open a saved workspace (after creating/joining it, or from the dashboard). */
export function openWorkspace(workspaceId: string) {
  try {
    sessionStorage.setItem(WORKSPACE_KEY, workspaceId);
  } catch {
    // Storage blocked: the office falls back to the most recent workspace.
  }
}

export function forgetWorkspace() {
  try {
    sessionStorage.removeItem(WORKSPACE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** What decides which office opens in this tab (used to reuse a prepared office). */
export function officeStateKey() {
  return storedWorkspaceId() ?? "";
}

/** Stable key: the same answers always produce the same office. */
export const layoutKey = (c: OfficeConfig) => [c.layout, c.workspaceName.toLowerCase(), c.workspaceStyle, c.teamSize, c.purpose, c.features?.join(",") ?? "default"].join("|");
