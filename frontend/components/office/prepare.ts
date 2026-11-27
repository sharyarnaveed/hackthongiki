import { ApiError } from "@/lib/api";
import { forgetWorkspace, officeStateKey, storedWorkspaceId, toOfficeConfig, type OfficeConfig } from "./config";
import { buildArt, type OfficeArt } from "./game/assets";
import type { OfficeMap } from "./game/map";
import { getMyWorkspaces, getOffice, type SavedOffice } from "./service";

export interface PreparedOffice {
  config: OfficeConfig;
  map: OfficeMap;
  art: OfficeArt;
  Phaser: typeof import("phaser");
}

export const STAGES = ["Preparing your workspace", "Arranging desks and rooms", "Getting your avatar ready", "Opening the office"] as const;

/** Kept across client navigations so `/office` reuses what `/office/loading` prepared. */
let cache: { key: string; config: Promise<OfficeConfig>; promise: Promise<PreparedOffice> } | null = null;

/** Drop the prepared office, e.g. after the server saved a new plan. */
export function resetPreparedOffice() {
  cache = null;
}

/** The signed-in user has no workspace yet: there is no office to open. */
export class NoWorkspaceError extends Error {
  constructor() {
    super("You don't belong to any workspace yet.");
  }
}

const signIn = () => window.location.assign(`/signin?next=${encodeURIComponent("/office/loading")}`);

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A saved workspace office as sent by the server, checked before Phaser touches it. */
function fromServer(s: SavedOffice): { config: OfficeConfig; map: OfficeMap } {
  const c = s.config;
  const base = toOfficeConfig({ ...c, officeLayout: c.layout, officeFeatures: c.features });
  const m = s.office;
  if (!base || !m || !Array.isArray(m.tiles) || m.tiles.length !== m.height || !Array.isArray(m.objects) || !m.spawn) {
    throw new Error("The saved office is missing or damaged.");
  }
  return {
    map: m,
    config: {
      ...base,
      workspaceId: s.workspace.workspaceId,
      role: s.role,
      seats: Array.isArray(s.seats) ? s.seats : undefined,
      status: s.me?.status,
      preferences: s.preferences,
      position: s.me?.position ?? null,
      officeSavedAt: s.savedAt,
    },
  };
}

/** Fetch a workspace's saved office, or null if it's gone / not ours. */
async function fetchOffice(id: string) {
  try {
    return await getOffice(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) signIn();
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

/**
 * Which office to open: the workspace picked in this tab, else the user's most
 * recent workspace. Offices only ever come from the server; with no workspace
 * at all this throws `NoWorkspaceError` and the caller sends them to onboarding.
 */
async function loadSource(): Promise<{ config: OfficeConfig; map: OfficeMap }> {
  const stored = storedWorkspaceId();
  if (stored) {
    const saved = await fetchOffice(stored);
    if (saved) return fromServer(saved);
    forgetWorkspace();
  }
  let mine;
  try {
    mine = await getMyWorkspaces();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) signIn();
    throw err;
  }
  const latest = mine.workspaces[0]?.workspaceId;
  if (latest) {
    const saved = await fetchOffice(latest);
    if (saved) return fromServer(saved);
  }
  throw new NoWorkspaceError();
}

/**
 * Everything the office needs before Phaser starts: the saved (server-generated)
 * layout, the painted textures and the Phaser bundle itself. `onStage` reports
 * real progress (index into STAGES) as each piece finishes; `onConfig` gets the
 * office's details as soon as they're known.
 */
export function prepareOffice(onStage?: (i: number) => void, onConfig?: (c: OfficeConfig) => void): Promise<PreparedOffice> {
  const key = officeStateKey();
  if (cache?.key === key) {
    cache.config.then((c) => onConfig?.(c)).catch(() => {});
    onStage?.(STAGES.length - 1);
    return cache.promise;
  }
  onStage?.(0);
  const phaser = import("phaser");
  const source = loadSource();
  const config = source.then((s) => s.config);
  const promise = (async () => {
    const { map } = await source;
    onStage?.(1);
    await tick();
    onStage?.(2);
    const art = buildArt(map, await config);
    const { default: Phaser } = await phaser;
    onStage?.(3);
    return { config: await config, map, art, Phaser };
  })();
  config.then((c) => onConfig?.(c)).catch(() => {});
  cache = { key, config, promise };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}
