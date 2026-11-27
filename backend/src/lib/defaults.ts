import type { FastifyBaseLogger } from "fastify";
import { UserModel } from "../models/User.ts";
import { WorkspaceModel } from "../models/Workspace.ts";
import { DEFAULT_STATUS } from "./status.ts";

/** Office settings every new account starts with (mirrors the office HUD toggles). */
export const DEFAULT_PREFERENCES = { sound: false, minimap: true, nameTag: true } as const;
export type Preferences = { sound: boolean; minimap: boolean; nameTag: boolean };

export { DEFAULT_STATUS, STATUSES, type MemberStatus } from "./status.ts";

/** Stored preferences with any missing key filled from the defaults. */
export function preferencesOf(stored: Partial<Preferences> | null | undefined): Preferences {
  return {
    sound: stored?.sound ?? DEFAULT_PREFERENCES.sound,
    minimap: stored?.minimap ?? DEFAULT_PREFERENCES.minimap,
    nameTag: stored?.nameTag ?? DEFAULT_PREFERENCES.nameTag,
  };
}

/**
 * Write the defaults into documents created before these fields existed, so
 * every user and member in MongoDB has real values. Safe to run on every start.
 */
export async function backfillDefaults(log: FastifyBaseLogger) {
  const users = await UserModel.updateMany({ preferences: { $exists: false } }, { $set: { preferences: DEFAULT_PREFERENCES } });
  const members = await WorkspaceModel.updateMany(
    { members: { $elemMatch: { status: { $exists: false } } } },
    { $set: { "members.$[m].status": DEFAULT_STATUS } },
    { arrayFilters: [{ "m.status": { $exists: false } }] },
  );
  if (users.modifiedCount || members.modifiedCount) {
    log.info({ users: users.modifiedCount, workspaces: members.modifiedCount }, "🧩 Default settings saved for older records");
  } else {
    log.info("🧩 Default settings: every record already has them");
  }
}
