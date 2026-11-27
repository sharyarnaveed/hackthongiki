import { TILE } from "@/components/office/game/tiles";

/** The saved office as far as standing spots are concerned. */
type Floor = { width: number; height: number; walls?: boolean[][] } | null | undefined;

/**
 * Whether (x, y) — the avatar's feet in world pixels — is inside the office
 * and not inside a wall. Furniture isn't checked here; the client falls back
 * to the spawn point if the saved spot is blocked.
 */
export function isStandingSpot(office: Floor, x: number, y: number) {
  if (!office || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor((y - 3) / TILE);
  if (tx < 0 || ty < 0 || tx >= office.width || ty >= office.height) return false;
  return !office.walls?.[ty]?.[tx];
}
