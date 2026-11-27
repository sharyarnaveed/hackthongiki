import { toOfficeConfig } from "@/components/office/config";
import { generateOffice, type OfficeMap } from "@/components/office/game/map";
import { nameFromEmail } from "@/components/office/game/seating";
import type { WorkspaceModel } from "../models/Workspace.ts";

/**
 * Server-side office generation. The generator is the frontend's own pure
 * TypeScript (no DOM, no Phaser), shared so the server builds exactly the
 * office the client would. The result is stored on the workspace, so the
 * furniture never moves between visits, devices or generator changes.
 */

type Ws = InstanceType<typeof WorkspaceModel>;

/** Only the workspace answers affect the map, so any member's view of it is the same. */
type OfficeInput = Pick<Ws, "name" | "description" | "purpose" | "teamSize" | "style" | "layout" | "features"> & {
  invitations: { email: string }[];
  /** Members besides the owner also need desks, so the plan makes room for them. */
  members?: { displayName: string; role?: string | null }[];
};

export function officeConfigFor(ws: OfficeInput, viewer?: { displayName: string; avatarId: string }) {
  const config = toOfficeConfig({
    displayName: viewer?.displayName ?? "Owner",
    avatarId: viewer?.avatarId,
    workspaceName: ws.name,
    workspaceDescription: ws.description,
    purpose: ws.purpose,
    teamSize: ws.teamSize,
    workspaceStyle: ws.style,
    officeLayout: ws.layout,
    officeFeatures: ws.features,
    teammates: [
      ...(ws.members ?? []).filter((m) => m.role !== "owner").map((m) => m.displayName),
      ...ws.invitations.map((i) => nameFromEmail(i.email)),
    ],
  });
  if (!config) throw new Error("Workspace settings could not be turned into an office");
  return config;
}

/** Short description of a generated office for log lines. */
export const officeSummary = (map: OfficeMap) => ({
  size: `${map.width}×${map.height}`,
  objects: map.objects.length,
  desks: map.objects.filter((o) => o.desk !== undefined).length,
  rooms: map.rooms.map((r) => r.name),
  seed: map.seed,
});

export function buildOffice(ws: OfficeInput, log?: { info: (obj: object, msg: string) => void }): OfficeMap {
  const started = performance.now();
  const map = generateOffice(officeConfigFor(ws));
  log?.info(
    { workspace: ws.name, layout: ws.layout, style: ws.style, teamSize: ws.teamSize, ms: Math.round(performance.now() - started), ...officeSummary(map) },
    "🪑 Office generated on the server",
  );
  return map;
}
