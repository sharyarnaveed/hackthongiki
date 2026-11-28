import type { PlacedObject } from "./builder";

/**
 * Rules for moving furniture around a saved office. Pure TypeScript shared by
 * the office's arrange mode (instant feedback while dragging) and the server
 * (which checks the same rules before saving the layout for everyone).
 */

/** What the rules need to know about each object kind: its collision footprint and draw layer. */
export type FurnitureMeta = Record<string, { footprint: { w: number; h: number } | null; layer: "floor" | "wall" | "sort" }>;

/** The parts of a saved office the rules look at. */
export interface LayoutFloor {
  width: number;
  height: number;
  walls: boolean[][];
  objects: PlacedObject[];
  spawn: { tx: number; ty: number };
}

type Spot = { tx: number; ty: number };

/** One moved object: where it was (to catch a stale tab) and where it goes. */
export type FurnitureMove = { index: number; kind: string; from: Spot; to: Spot };

/** Parts of the building and floor/wall decorations stay where the plan put them. */
const FIXED = new Set(["rug", "sign", "mat", "partition-h", "partition-v"]);

export const isMovable = (o: PlacedObject, meta: FurnitureMeta) => !FIXED.has(o.kind) && meta[o.kind]?.layer === "sort";

/** Friendly name for messages ("coffee-machine" → "coffee machine"). */
export const kindLabel = (kind: string) => (kind === "desk-mine" ? "desk" : kind.replace(/-[lr]$/, "").replace(/-/g, " "));

/**
 * The object plus anything that travels with it: a desk and the chair tucked
 * behind it move together, whichever of the two you pick up. The desk comes first.
 */
export function groupOf(objects: PlacedObject[], index: number): number[] {
  const o = objects[index];
  if (!o) return [];
  const isDesk = (k: string) => k === "desk" || k === "desk-mine";
  if (isDesk(o.kind)) {
    const chair = objects.findIndex((c) => c.kind === "desk-chair" && c.tx === o.tx && c.ty === o.ty - 1);
    return chair >= 0 ? [index, chair] : [index];
  }
  if (o.kind === "desk-chair") {
    const desk = objects.findIndex((d) => isDesk(d.kind) && d.tx === o.tx && d.ty === o.ty + 1);
    return desk >= 0 ? [desk, index] : [index];
  }
  return [index];
}

/** Tiles an object takes up: its footprint (measured up from its bottom-left tile), or just its own tile if you can walk through it. */
export function tilesOf(o: PlacedObject, meta: FurnitureMeta): Spot[] {
  const fp = meta[o.kind]?.footprint;
  if (!fp) return [{ tx: o.tx, ty: o.ty }];
  const out: Spot[] = [];
  for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) out.push({ tx: o.tx + i, ty: o.ty - j });
  return out;
}

/**
 * The whole tiles the entrance covers. The spawn point can sit between two tiles
 * (e.g. tx 13.5 on even-width plans), in which case it covers both.
 */
export function entranceTiles(spawn: Spot): Spot[] {
  const xs = [...new Set([Math.floor(spawn.tx), Math.ceil(spawn.tx)])];
  const ys = [...new Set([Math.floor(spawn.ty), Math.ceil(spawn.ty)])];
  return xs.flatMap((tx) => ys.map((ty) => ({ tx, ty })));
}

const solid = (o: PlacedObject, meta: FurnitureMeta) => !!meta[o.kind]?.footprint && meta[o.kind]?.layer === "sort";
const key = (x: number, y: number) => `${x},${y}`;

/** Every tile blocked by a solid object, except the ones listed in `skip`. */
function blockedTiles(objects: PlacedObject[], meta: FurnitureMeta, skip: Set<number>) {
  const out = new Set<string>();
  objects.forEach((o, i) => {
    if (skip.has(i) || !solid(o, meta)) return;
    for (const t of tilesOf(o, meta)) out.add(key(t.tx, t.ty));
  });
  return out;
}

/**
 * Why the objects in `group` can't stand where they are now in `floor.objects`,
 * or null if the spot is fine: inside the walls, not on top of other furniture,
 * and not on the entrance.
 */
export function placementProblem(floor: LayoutFloor, group: number[], meta: FurnitureMeta): string | null {
  const own = new Set(group);
  const others = blockedTiles(floor.objects, meta, own);
  // Walk-through pieces (a stool, the cat) stand on a tile of their own too.
  const otherSpots = new Set<string>();
  floor.objects.forEach((o, i) => {
    if (!own.has(i) && o.kind !== "rug" && meta[o.kind]?.layer === "sort" && !solid(o, meta)) otherSpots.add(key(o.tx, o.ty));
  });
  const mine = new Set<string>();
  const entrance = new Set(entranceTiles(floor.spawn).map((t) => key(t.tx, t.ty)));
  for (const i of group) {
    const o = floor.objects[i];
    if (!o) return "That piece isn't in the office any more.";
    for (const t of tilesOf(o, meta)) {
      // Row 0–1 is the thick top wall; everything else must be inside the shell.
      if (t.tx < 1 || t.ty < 2 || t.tx >= floor.width - 1 || t.ty >= floor.height - 1) return "That's outside the office.";
      if (floor.walls[t.ty]?.[t.tx]) return "That spot is inside a wall.";
      const k = key(t.tx, t.ty);
      if (others.has(k) || otherSpots.has(k) || mine.has(k)) return "Something is already standing there.";
      if (entrance.has(k)) return "Keep the entrance clear.";
      mine.add(k);
    }
  }
  return null;
}

/**
 * Interactive objects nobody can walk up to from the entrance (indices). Used
 * to stop a layout from boxing off part of the office.
 */
export function unreachable(floor: LayoutFloor, meta: FurnitureMeta): number[] {
  const blocked = blockedTiles(floor.objects, meta, new Set());
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < floor.width && y < floor.height && !floor.walls[y][x] && !blocked.has(key(x, y));
  const seen = new Set<string>();
  const queue: Spot[] = [];
  const visit = (x: number, y: number) => {
    const k = key(x, y);
    if (seen.has(k) || !free(x, y)) return;
    seen.add(k);
    queue.push({ tx: x, ty: y });
  };
  for (const t of entranceTiles(floor.spawn)) visit(t.tx, t.ty);
  for (let q = 0; q < queue.length; q++) {
    const { tx, ty } = queue[q];
    visit(tx + 1, ty);
    visit(tx - 1, ty);
    visit(tx, ty + 1);
    visit(tx, ty - 1);
  }
  const out: number[] = [];
  floor.objects.forEach((o, i) => {
    if (!o.interact || meta[o.kind]?.layer !== "sort") return;
    const tiles = tilesOf(o, meta);
    const near = tiles.some(({ tx, ty }) =>
      [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => seen.has(key(tx + dx, ty + dy))),
    );
    if (!near) out.push(i);
  });
  return out;
}

/**
 * Whether `next` boxes off something that `before` could still reach: returns a
 * message naming it, or null.
 */
export function blocksTheWay(before: LayoutFloor, next: LayoutFloor, meta: FurnitureMeta): string | null {
  const was = new Set(unreachable(before, meta));
  const cut = unreachable(next, meta).find((i) => !was.has(i));
  return cut === undefined ? null : `That would block the way to the ${kindLabel(next.objects[cut].kind)}.`;
}

/** Apply moves to a copy of the objects. Returns null if a move doesn't match the office (a stale tab). */
export function applyMoves(objects: PlacedObject[], moves: FurnitureMove[], meta: FurnitureMeta): PlacedObject[] | null {
  const next = objects.map((o) => ({ ...o }));
  const done = new Set<number>();
  for (const m of moves) {
    const o = next[m.index];
    if (!o || done.has(m.index) || o.kind !== m.kind || o.tx !== m.from.tx || o.ty !== m.from.ty || !isMovable(o, meta)) return null;
    o.tx = m.to.tx;
    o.ty = m.to.ty;
    done.add(m.index);
  }
  return next;
}
