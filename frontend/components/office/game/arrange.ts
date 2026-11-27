import { tierOf, type LayoutId, type StyleId } from "@/components/onboarding/model";
import type { OfficeConfig } from "../config";
import { FEATURES, type FeatureId } from "../features";
import type { Builder, PlacedObject, Room } from "./builder";
import { catalog, signFrame, type ObjectDef } from "./furniture";
import type { InteractionId } from "./interactions";
import type { Theme } from "./themes";

/**
 * Interior planner. A floor plan supplies the building — walls, doors,
 * windows and named rooms — and this file furnishes it from the onboarding
 * answers, room by room, the way an interior designer would:
 *
 * - Each room gets a role from its name (work, meeting, kitchen, lounge…) and
 *   a recipe for that role, built only from the features the user ticked.
 * - Furniture comes in groups that belong together (a sofa facing a coffee
 *   table with armchairs either side on a rug; a meeting table with chairs on
 *   every side and a screen on the wall above; a kitchen run of counters,
 *   sink, coffee machine and fridge along the back wall). A group is placed
 *   whole or not at all, so there are no orphan rugs, stools or tables.
 * - Desks are sized for the team (the larger of the team-size tier and you +
 *   invited teammates) and laid out as paired rows with aisles.
 * - Anything ticked that the plan has no room for (say, sofas when there is
 *   no lounge) goes into the emptiest suitable room, which is renamed to match.
 * - Plants, art and shelves are finishing touches added last, with density
 *   set by the chosen style.
 *
 * Every placement is checked so it never blocks a doorway, cuts off part of
 * the office, or stops the player reaching something they can use.
 */

type Kind = PlacedObject["kind"];
type Defs = Record<string, ObjectDef>;
type Role = "work" | "meeting" | "call" | "kitchen" | "lounge" | "quiet" | "entrance" | "hall" | "bedroom" | "library" | "greenhouse";

interface StyleDecor {
  /** Chance a free corner gets something, and what it gets. */
  corner: number;
  cornerKinds: Kind[];
  /** Wall pieces cycled through, and the minimum tiles between two. */
  wall: Kind[];
  wallGap: number;
  /** Chance a room with a long bare wall gets a low cabinet. */
  sideboard: number;
}

const DECOR: Record<StyleId, StyleDecor> = {
  "cozy-green": { corner: 0.8, cornerKinds: ["plant", "tree", "small-plant"], wall: ["wall-planter", "art", "wall-shelf"], wallGap: 3, sideboard: 0.6 },
  "creative-studio": { corner: 0.55, cornerKinds: ["plant", "lamp", "small-plant"], wall: ["poster", "art", "poster", "wall-shelf"], wallGap: 2, sideboard: 0.7 },
  "quiet-minimal": { corner: 0.3, cornerKinds: ["small-plant"], wall: ["art"], wallGap: 8, sideboard: 0.3 },
  "community-lounge": { corner: 0.6, cornerKinds: ["plant", "lamp", "tree"], wall: ["art", "wall-shelf", "poster"], wallGap: 3, sideboard: 0.6 },
};

/** Room name → role. First match wins; anything else is treated as work space. */
const ROLES: [RegExp, Role][] = [
  [/greenhouse/i, "greenhouse"],
  [/bedroom/i, "bedroom"],
  [/library/i, "library"],
  [/meeting|group room/i, "meeting"],
  [/call|phone/i, "call"],
  [/kitchen|coffee|caf/i, "kitchen"],
  [/lounge|living|common|break|reading|book swap/i, "lounge"],
  [/quiet|focus/i, "quiet"],
  [/entrance|entry/i, "entrance"],
  [/desk|workbench|cubicle|study hall|office|studio|loft|garden/i, "work"],
  [/hall/i, "hall"],
];
const roleOf = (name: string): Role => ROLES.find(([re]) => re.test(name))?.[1] ?? "work";

const FEATURE_OF = new Map<string, FeatureId>(FEATURES.flatMap((f) => f.kinds.map((k) => [k, f.id] as const)));

interface Zone {
  room: Room;
  role: Role;
  mask: boolean[][];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  /** A room that wraps other rooms (e.g. the whole "Office floor"); this zone is what's left of it. */
  catchAll: boolean;
}

/* ------------------------------------------------------------------ */
/* Map queries                                                         */
/* ------------------------------------------------------------------ */

/** Shared view of the map: what blocks movement, what is occupied, where doors are. */
class Space {
  readonly w: number;
  readonly h: number;
  constructor(
    private b: Builder,
    private defs: Defs,
    readonly spawn: { x: number; y: number },
  ) {
    this.w = b.width;
    this.h = b.height;
  }

  wall = (x: number, y: number) => x < 0 || y < 0 || x >= this.w || y >= this.h || this.b.walls[y][x];

  def(kind: Kind) {
    return kind === "rug" || kind === "sign" ? null : this.defs[kind];
  }

  footprint(o: PlacedObject) {
    return this.def(o.kind)?.footprint ?? null;
  }

  /** Tiles an object stands on (walk-through objects still cover their own tile). */
  tiles(o: PlacedObject): [number, number][] {
    const def = this.def(o.kind);
    if (!def || def.layer !== "sort") return [];
    const fp = def.footprint ?? { w: 1, h: 1 };
    const out: [number, number][] = [];
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) out.push([o.tx + i, o.ty - j]);
    return out;
  }

  /** Movement-blocking grid: walls plus solid footprints. */
  blocked(extra: PlacedObject[] = []) {
    const g = this.b.walls.map((row) => row.slice());
    for (const o of [...this.b.objects, ...extra]) {
      const fp = this.footprint(o);
      if (!fp) continue;
      for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) if (g[o.ty - j]?.[o.tx + i] !== undefined) g[o.ty - j][o.tx + i] = true;
    }
    return g;
  }

  /** Doorway tiles (floor squeezed between two walls), the tiles around them, and the spawn. */
  nearDoor() {
    const g = this.b.walls.map((row) => row.map(() => false));
    const set = (x: number, y: number) => g[y]?.[x] !== undefined && (g[y][x] = true);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.wall(x, y)) continue;
        const across = this.wall(x - 1, y) && this.wall(x + 1, y);
        const along = this.wall(x, y - 1) && this.wall(x, y + 1);
        if (!across && !along) continue;
        for (let j = -2; j <= 2; j++) for (let i = -1; i <= 1; i++) set(x + (along ? j : i), y + (along ? i : j));
      }
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) set(this.spawn.x + i, this.spawn.y + j);
    return g;
  }

  /** Flood fill from the spawn over unblocked tiles. */
  reach(blocked: boolean[][]) {
    const seen = blocked.map((row) => row.map(() => false));
    const stack: [number, number][] = [[this.spawn.x, this.spawn.y]];
    let count = 0;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h || seen[y][x] || blocked[y][x]) continue;
      seen[y][x] = true;
      count++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return { seen, count };
  }

  /** Interactive objects the player can stand next to. */
  reachableTargets(seen: boolean[][]) {
    const ok = new Set<PlacedObject>();
    for (const o of this.b.objects) {
      if (!o.interact) continue;
      const fp = this.footprint(o) ?? { w: o.w ?? 1, h: 1 };
      let hit = false;
      for (let j = -1; j <= fp.h && !hit; j++) for (let i = -1; i <= fp.w && !hit; i++) if (seen[o.ty - fp.h + 1 + j]?.[o.tx + i]) hit = true;
      if (hit) ok.add(o);
    }
    return ok;
  }
}

/** Checks placements so they never cut off part of the office or an interactive object. */
class Guard {
  private base: ReturnType<Space["reach"]>;
  private targets: Set<PlacedObject>;
  constructor(
    private b: Builder,
    private space: Space,
  ) {
    this.base = space.reach(space.blocked());
    this.targets = space.reachableTargets(this.base.seen);
  }

  private accept(o: PlacedObject) {
    const { b, space } = this;
    if (!space.footprint(o)) {
      b.objects.push(o);
      if (o.interact) this.targets = space.reachableTargets(this.base.seen);
      return true;
    }
    const after = space.reach(space.blocked([o]));
    const lost = space.tiles(o).filter(([x, y]) => this.base.seen[y]?.[x]).length;
    if (after.count !== this.base.count - lost) return false;
    b.objects.push(o);
    const now = space.reachableTargets(after.seen);
    if ([...this.targets].some((t) => !now.has(t)) || (o.interact && !now.has(o))) {
      b.objects.pop();
      return false;
    }
    this.base = after;
    this.targets = now;
    return true;
  }

  /** Place a group of objects all together, or none of them. */
  placeAll(group: PlacedObject[]) {
    const placed: PlacedObject[] = [];
    for (const o of group) {
      if (this.accept(o)) placed.push(o);
      else {
        for (const p of placed) this.b.objects.splice(this.b.objects.indexOf(p), 1);
        this.base = this.space.reach(this.space.blocked());
        this.targets = this.space.reachableTargets(this.base.seen);
        return false;
      }
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Furniture groups                                                    */
/* ------------------------------------------------------------------ */

/** A set of objects laid out in a `w`×`h` box whose top-left tile is (x, y). */
interface Group {
  w: number;
  h: number;
  make(x: number, y: number): PlacedObject[];
}

const sofaSeat = { interact: "sofa" as InteractionId };

/** Sofas facing down onto a coffee table, armchairs turned in from the sides, optional rug, lamp and cat. */
function loungeGroup(opts: { rug: boolean; lamp: boolean; cat: boolean; compact: boolean }): Group {
  if (opts.compact)
    return {
      w: 4,
      h: 4,
      make: (x, y) => [
        ...(opts.rug ? [{ kind: "rug" as const, tx: x, ty: y + 3, w: 4, h: 4 }] : []),
        { kind: "sofa", tx: x + 1, ty: y, ...sofaSeat },
        { kind: "coffee-table", tx: x + 1, ty: y + 2 },
        { kind: "armchair-r", tx: x, ty: y + 2, ...sofaSeat },
        ...(opts.lamp ? [{ kind: "side-table" as const, tx: x + 3, ty: y }] : []),
        ...(opts.cat ? [{ kind: "cat" as const, tx: x + 3, ty: y + 3, interact: "cat" as InteractionId }] : []),
      ],
    };
  return {
    w: 6,
    h: 4,
    make: (x, y) => [
      ...(opts.rug ? [{ kind: "rug" as const, tx: x, ty: y + 3, w: 6, h: 4 }] : []),
      { kind: "sofa", tx: x + 1, ty: y, ...sofaSeat },
      { kind: "sofa", tx: x + 3, ty: y, ...sofaSeat },
      { kind: "coffee-table", tx: x + 2, ty: y + 2 },
      { kind: "armchair-r", tx: x + 1, ty: y + 2, ...sofaSeat },
      { kind: "armchair-l", tx: x + 4, ty: y + 2, ...sofaSeat },
      ...(opts.lamp ? [{ kind: "side-table" as const, tx: x + 5, ty: y }] : []),
      ...(opts.cat ? [{ kind: "cat" as const, tx: x + 4, ty: y + 3, interact: "cat" as InteractionId }] : []),
    ],
  };
}

/** Seating that faces up towards a fireplace: armchairs and table in front, sofa backs behind. */
function fireGroup(opts: { rug: boolean; cat: boolean }): Group {
  return {
    w: 6,
    h: 3,
    make: (x, y) => [
      ...(opts.rug ? [{ kind: "rug" as const, tx: x, ty: y + 2, w: 6, h: 3 }] : []),
      { kind: "armchair-r", tx: x + 1, ty: y, ...sofaSeat },
      { kind: "coffee-table", tx: x + 2, ty: y },
      { kind: "armchair-l", tx: x + 4, ty: y, ...sofaSeat },
      { kind: "sofa-back", tx: x + 1, ty: y + 2, ...sofaSeat },
      { kind: "sofa-back", tx: x + 3, ty: y + 2, ...sofaSeat },
      ...(opts.cat ? [{ kind: "cat" as const, tx: x, ty: y + 1, interact: "cat" as InteractionId }] : []),
    ],
  };
}

/** Meeting table with chairs on all four sides. */
function meetingGroup(rug: boolean): Group {
  return {
    w: 6,
    h: 4,
    make: (x, y) => [
      ...(rug ? [{ kind: "rug" as const, tx: x, ty: y + 3, w: 6, h: 4 }] : []),
      ...[1, 2, 3, 4].map((i) => ({ kind: "chair" as const, tx: x + i, ty: y })),
      { kind: "meeting-table", tx: x + 1, ty: y + 2, interact: "meeting" },
      { kind: "chair-r", tx: x, ty: y + 2 },
      { kind: "chair-l", tx: x + 5, ty: y + 2 },
      ...[1, 2, 3, 4].map((i) => ({ kind: "chair-back" as const, tx: x + i, ty: y + 3 })),
    ],
  };
}

/** A round café table with a stool either side. */
const CAFE: Group = {
  w: 4,
  h: 1,
  make: (x, y) => [
    { kind: "stool", tx: x, ty: y },
    { kind: "round-table", tx: x + 1, ty: y },
    { kind: "stool", tx: x + 3, ty: y },
  ],
};

/** Long picnic table with stools on the near side. */
const PICNIC: Group = {
  w: 4,
  h: 2,
  make: (x, y) => [...[0, 1, 2, 3].map((i) => ({ kind: "stool" as const, tx: x + i, ty: y })), { kind: "long-table", tx: x, ty: y + 1 }],
};

/** Two armchairs either side of a small table, for waiting or reading. */
const NOOK: Group = {
  w: 4,
  h: 1,
  make: (x, y) => [
    { kind: "armchair-r", tx: x, ty: y, ...sofaSeat },
    { kind: "coffee-table", tx: x + 1, ty: y },
    { kind: "armchair-l", tx: x + 3, ty: y, ...sofaSeat },
  ],
};

/** Reception desk with its chair behind. */
const RECEPTION: Group = {
  w: 3,
  h: 2,
  make: (x, y) => [
    { kind: "chair", tx: x + 1, ty: y },
    { kind: "reception", tx: x, ty: y + 1, interact: "workspace" },
  ],
};

/** Kitchen runs along the back wall, longest first; the shorter ones fit small kitchens. */
const KITCHEN_RUNS: Kind[][] = [
  ["counter", "sink", "coffee-machine", "counter", "fridge"],
  ["sink", "coffee-machine", "counter", "fridge"],
  ["sink", "coffee-machine", "fridge"],
  ["coffee-machine", "fridge"],
  ["coffee-machine"],
];

const INTERACT: Partial<Record<Kind, InteractionId>> = {
  "coffee-machine": "coffee",
  fridge: "fridge",
  "water-cooler": "water-cooler",
  bookshelf: "bookshelf",
  "record-player": "record-player",
  copier: "copier",
  fireplace: "fireplace",
  bed: "bed",
  "notice-board": "notice-board",
  plant: "plant",
  tree: "plant",
  "small-plant": "plant",
};

/* ------------------------------------------------------------------ */
/* The planner                                                         */
/* ------------------------------------------------------------------ */

class Interior {
  readonly space: Space;
  private guard: Guard;
  private occ: boolean[][];
  private rugs: boolean[][];
  private door: boolean[][];
  private wallTaken = new Set<string>();
  /** Floor tiles beside earlier wall runs, kept clear so pieces along a wall don't bunch up. */
  private runGap = new Set<string>();
  readonly zones: Zone[];

  constructor(
    readonly b: Builder,
    readonly defs: Defs,
    spawn: { x: number; y: number },
    private features: FeatureId[] | null,
  ) {
    this.space = new Space(b, defs, spawn);
    this.guard = new Guard(b, this.space);
    this.occ = b.walls.map((row) => row.map(() => false));
    this.rugs = b.walls.map((row) => row.map(() => false));
    for (const o of b.objects) this.mark(o);
    this.door = this.space.nearDoor();
    this.zones = this.findZones();
  }

  has = (f: FeatureId) => !this.features || this.features.includes(f);
  /** Whether anything from feature `f` has been placed yet. */
  placed = (f: FeatureId) => this.b.objects.some((o) => FEATURE_OF.get(o.kind) === f);

  /* ----- zones ----- */

  /** Rooms split into the floor tiles each one owns (first listed room wins), one zone per connected patch. */
  private findZones(): Zone[] {
    const { b, space } = this;
    const owner = b.walls.map((row, y) => row.map((w, x) => (w ? -1 : b.rooms.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h))));
    const seen = b.walls.map((row) => row.map(() => false));
    const zones: Zone[] = [];
    for (let y = 0; y < space.h; y++)
      for (let x = 0; x < space.w; x++) {
        const id = owner[y][x];
        if (id < 0 || seen[y][x]) continue;
        const mask = b.walls.map((row) => row.map(() => false));
        const stack: [number, number][] = [[x, y]];
        let area = 0;
        let x0 = x, y0 = y, x1 = x, y1 = y;
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          if (owner[cy]?.[cx] !== id || seen[cy][cx]) continue;
          seen[cy][cx] = mask[cy][cx] = true;
          area++;
          x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
          stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
        if (area < 2) continue;
        const room = b.rooms[id];
        const catchAll = b.rooms.some((o) => o !== room && o.x >= room.x && o.y >= room.y && o.x + o.w <= room.x + room.w && o.y + o.h <= room.y + room.h);
        zones.push({ room, role: roleOf(room.name), mask, x0, y0, x1, y1, area, catchAll });
      }
    return zones;
  }

  /** Floor tiles in the zone not yet used and not next to a door. */
  freeCount(z: Zone) {
    let n = 0;
    for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (this.free(x, y, z)) n++;
    return n;
  }

  /** Objects standing in the zone. */
  contents(z: Zone) {
    return this.b.objects.filter((o) => this.space.tiles(o).some(([x, y]) => z.mask[y]?.[x]));
  }

  /* ----- placement primitives ----- */

  /** Booths are tiny and wholly beside their door; while set, the doorway margin is ignored. */
  relaxDoors = false;

  free(x: number, y: number, z?: Zone) {
    return !this.space.wall(x, y) && !this.occ[y][x] && (this.relaxDoors || !this.door[y][x]) && (!z || z.mask[y][x]);
  }

  private mark(o: PlacedObject) {
    for (const [x, y] of this.space.tiles(o)) if (this.occ[y]?.[x] !== undefined) this.occ[y][x] = true;
    if (o.kind === "mat") for (let i = 0; i < (o.w ?? 1); i++) if (this.occ[o.ty]?.[o.tx + i] !== undefined) this.occ[o.ty][o.tx + i] = true;
    if (o.kind === "rug" && o.w && o.h) for (let j = 0; j < o.h; j++) for (let i = 0; i < o.w; i++) if (this.rugs[o.ty - j]?.[o.tx + i] !== undefined) this.rugs[o.ty - j][o.tx + i] = true;
  }

  /** Place objects whose tiles are all free (inside `z` if given), all or nothing. */
  putAll(objs: PlacedObject[], z?: Zone) {
    const list = objs.filter((o) => {
      const f = FEATURE_OF.get(o.kind);
      return !f || this.has(f);
    });
    if (!list.length) return false;
    for (const o of list) if (this.space.tiles(o).some(([x, y]) => !this.free(x, y, z))) return false;
    if (!this.guard.placeAll(list)) return false;
    list.forEach((o) => this.mark(o));
    return true;
  }

  put(o: PlacedObject, z?: Zone) {
    return this.putAll([o], z);
  }

  /**
   * Place a group in the zone: every tile of its box must be free floor, with
   * a clear (or wall) tile all round so it never crowds other furniture.
   */
  fit(z: Zone, g: Group, prefer: "top" | "center" | "bottom" = "center") {
    const cx = (z.x0 + z.x1 + 1) / 2 - g.w / 2;
    const cy = (z.y0 + z.y1 + 1) / 2 - g.h / 2;
    const spots: [number, number][] = [];
    for (let y = z.y0; y + g.h - 1 <= z.y1; y++) for (let x = z.x0; x + g.w - 1 <= z.x1; x++) spots.push([x, y]);
    const score = ([x, y]: [number, number]) =>
      prefer === "top" ? (y - z.y0) * 100 + Math.abs(x - cx) : prefer === "bottom" ? (z.y1 - y) * 100 + Math.abs(x - cx) : Math.hypot(x - cx, (y - cy) * 1.2);
    spots.sort((p, q) => score(p) - score(q));
    for (const [x, y] of spots) {
      if (!this.boxClear(z, x, y, g.w, g.h)) continue;
      if (this.putAll(g.make(x, y), z)) return { x, y };
    }
    return null;
  }

  private boxClear(z: Zone, x: number, y: number, w: number, h: number) {
    for (let j = y - 1; j <= y + h; j++)
      for (let i = x - 1; i <= x + w; i++) {
        const inside = i >= x && i < x + w && j >= y && j < y + h;
        if (inside ? !this.free(i, j, z) || this.rugs[j][i] : !this.space.wall(i, j) && (this.occ[j]?.[i] || this.rugs[j]?.[i])) return false;
      }
    return true;
  }

  private width(kind: Kind) {
    return this.space.def(kind)?.footprint?.w ?? 1;
  }

  /**
   * Line furniture up against the zone's back (top) wall, left to right,
   * keeping the row in front clear. `align` picks which end of the wall.
   */
  wallRun(z: Zone, kinds: Kind[], align: "left" | "right" | "center" = "left") {
    const list = kinds.filter((k) => {
      const f = FEATURE_OF.get(k);
      return !f || this.has(f);
    });
    if (!list.length) return false;
    const total = list.reduce((s, k) => s + this.width(k), 0);
    const tall = list.some((k) => (this.space.def(k)?.frames[0].length ?? 0) > 18);
    // Tall pieces mustn't stand in front of something already hanging on the wall.
    const hung = (x: number, fy: number) =>
      this.b.objects.some((o) => o.ty === fy && (o.kind === "sign" || this.space.def(o.kind)?.layer === "wall") && x >= o.tx - 1 && x <= o.tx + (o.w ?? 1));
    for (let y = z.y0; y <= z.y1; y++) {
      const ok = (x: number) => {
        const fh = 1;
        return this.free(x, y, z) && this.space.wall(x, y - 1) && !this.space.wall(x, y + fh) && !this.occ[y + fh]?.[x] && !this.rugs[y][x] && !this.runGap.has(`${x},${y}`) && !(tall && hung(x, y - 1));
      };
      let run: number[] = [];
      const runs: number[][] = [];
      for (let x = z.x0; x <= z.x1 + 1; x++) {
        if (x <= z.x1 && ok(x)) run.push(x);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      for (const r of runs) {
        if (r.length < total) continue;
        let x = align === "left" ? r[0] : align === "right" ? r[r.length - total] : r[Math.floor((r.length - total) / 2)];
        const objs: PlacedObject[] = list.map((kind) => {
          const fp = this.space.def(kind)?.footprint ?? { w: 1, h: 1 };
          const o: PlacedObject = { kind, tx: x, ty: y + fp.h - 1, interact: INTERACT[kind] };
          x += fp.w;
          return o;
        });
        if (objs.some((o) => this.space.tiles(o).some(([tx, ty]) => !this.free(tx, ty, z)))) continue;
        if (this.putAll(objs, z)) {
          const start = objs[0].tx;
          this.runGap.add(`${start - 1},${y}`).add(`${start + total},${y}`);
          return true;
        }
      }
    }
    return false;
  }

  /** Hang something on the zone's back wall, as close to `preferX` as possible. */
  wallItem(z: Zone, kind: Kind, w = 1, preferX?: number, frame?: number) {
    const f = FEATURE_OF.get(kind);
    if (f && !this.has(f)) return false;
    const { space, b } = this;
    const windows = new Set(b.windows);
    for (let y = z.y0; y <= z.y1; y++) {
      const fy = y - 1;
      const face = (x: number) => z.mask[y]?.[x] && space.wall(x, fy) && !space.wall(x, y);
      const xs: number[] = [];
      for (let x = z.x0; x <= z.x1; x++) {
        let ok = space.wall(x - 1, fy) && space.wall(x + w, fy);
        for (let i = 0; i < w && ok; i++) {
          const xx = x + i;
          ok = !!face(xx) && !(fy === 1 && windows.has(xx)) && !this.wallTaken.has(`${xx},${fy}`) && !this.tallBelow(xx, fy);
        }
        if (ok) xs.push(x);
      }
      if (!xs.length) continue;
      const target = preferX ?? (z.x0 + z.x1) / 2;
      xs.sort((p, q) => Math.abs(p + w / 2 - target) - Math.abs(q + w / 2 - target));
      const x = xs[0];
      b.objects.push({ kind, tx: x, ty: fy, w, frame, interact: INTERACT[kind] });
      for (let i = -1; i <= w; i++) this.wallTaken.add(`${x + i},${fy}`);
      return true;
    }
    return false;
  }

  /** Is the wall face at (x, fy) hidden behind something tall standing in front of it? */
  tallBelow(x: number, fy: number) {
    return this.b.objects.some((o) => {
      const def = this.space.def(o.kind);
      if (!def || def.layer !== "sort" || o.kind === "sideboard") return false;
      const fw = def.footprint?.w ?? 1;
      const h = def.frames[0].length;
      return x >= o.tx && x < o.tx + fw && o.ty >= fy + 1 && o.ty <= fy + 2 && h - (o.ty - fy - 1) * 16 > 18;
    });
  }

  takeWall(x: number, y: number) {
    this.wallTaken.add(`${x},${y}`);
  }

  /* ----- desks ----- */

  /** Desk slots in a zone: pairs of desks with an aisle between pairs and between rows. */
  deskSlots(z: Zone, cubicles: boolean) {
    const rowStep = cubicles ? 4 : 3;
    const avail = z.x1 - z.x0 - 1;
    const pairs = Math.floor((avail + 1) / 5);
    const xs: number[] = [];
    if (pairs > 0) {
      const start = z.x0 + 1 + Math.floor((avail + 1 - pairs * 5) / 2);
      for (let p = 0; p < pairs; p++) xs.push(start + p * 5, start + p * 5 + 2);
    } else if (avail >= 2) xs.push(z.x0 + 1 + Math.floor((avail - 2) / 2));
    const ys: number[] = [];
    for (let y = z.y0 + (cubicles ? 3 : 2); y + 1 <= z.y1; y += rowStep) ys.push(y);
    const usable = (x: number, y: number) => {
      for (let i = 0; i < 2; i++) {
        if (!this.free(x + i, y, z) || !this.free(x + i, y - 1, z) || this.rugs[y][x + i]) return false;
        if (this.space.wall(x + i, y + 1) || this.occ[y + 1]?.[x + i]) return false;
        if (cubicles && (this.occ[y - 2]?.[x + i] || this.door[y - 2]?.[x + i])) return false;
      }
      return true;
    };
    return { xs, ys, usable };
  }

  /** Choose `n` slots forming a block in the middle of the zone, shaped like it. */
  pickDesks(z: Zone, n: number, cubicles: boolean) {
    const { xs, ys, usable } = this.deskSlots(z, cubicles);
    const all = ys.flatMap((y) => xs.map((x) => ({ x, y }))).filter((s) => usable(s.x, s.y));
    if (all.length <= n) return all;
    // Match the block's real shape (a desk is ~2.5 tiles wide with its aisle, a row 3 deep) to the room's.
    const aspect = Math.log((z.x1 - z.x0 + 1) / (z.y1 - z.y0 + 1));
    let best = { c: xs.length, r: Math.ceil(n / xs.length), score: Infinity };
    for (let r = 1; r <= ys.length; r++) {
      let c = Math.ceil(n / r);
      if (c % 2 && c < xs.length) c++; // keep desks in pairs
      if (c > xs.length) continue;
      const score = Math.abs(Math.log((c * 2.5) / (r * 3)) - aspect) + (c * r - n) * 0.3;
      if (score < best.score) best = { c, r, score };
    }
    const mid = <T,>(list: T[], k: number) => {
      let s = Math.floor((list.length - k) / 2);
      if (list === (xs as unknown as T[]) && s % 2) s--; // start on a pair
      return list.slice(Math.max(0, s), Math.max(0, s) + k);
    };
    const bx = new Set(mid(xs, best.c));
    const by = new Set(mid(ys, Math.min(best.r, ys.length)));
    const block = all.filter((s) => bx.has(s.x) && by.has(s.y));
    const cx = [...bx].reduce((a, b) => a + b, 0) / bx.size;
    const cy = [...by].reduce((a, b) => a + b, 0) / by.size;
    const rest = all.filter((s) => !block.includes(s)).sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
    return [...block, ...rest].slice(0, n).sort((p, q) => p.y - q.y || p.x - q.x);
  }

  /** Put down desks with their chairs; team desks are numbered from `first`. Returns how many fit. */
  placeDesks(z: Zone, slots: { x: number; y: number }[], interact: InteractionId, first = 0, cubicles = false) {
    let i = first;
    for (const s of slots) {
      const team = interact === "desk";
      const mine = team && i === 0;
      const ok = this.putAll(
        [
          { kind: "desk-chair", tx: s.x, ty: s.y - 1 },
          { kind: mine ? "desk-mine" : "desk", tx: s.x, ty: s.y, interact: mine ? "my-desk" : interact, desk: team ? i : undefined },
        ],
        z,
      );
      if (ok && team) i++;
    }
    if (cubicles) {
      // A glass-topped partition behind each row, with a bin at its end.
      const rows = new Map<number, number[]>();
      for (const o of this.b.objects) if (o.desk !== undefined && o.desk >= first && o.desk < i) rows.set(o.ty, [...(rows.get(o.ty) ?? []), o.tx]);
      for (const [y, xs] of rows) {
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs) + 1;
        for (let x = x0; x <= x1; x++) this.put({ kind: "partition-h", tx: x, ty: y - 2 }, z);
        this.put({ kind: "bin", tx: x1 + 1, ty: y }, z);
      }
    }
    return i - first;
  }
}

/* ------------------------------------------------------------------ */
/* Room recipes                                                        */
/* ------------------------------------------------------------------ */

interface Ctx {
  it: Interior;
  layout: LayoutId;
  style: StyleId;
  rand: () => number;
  /** Lounges furnished so far; only the first gets the full sofa set. */
  lounges: number;
}

function lounge(c: Ctx, z: Zone) {
  const { it } = c;
  const homey = c.layout === "home" || c.layout === "study-house";
  let seated = false;
  if (c.lounges++ > 0) {
    // One proper lounge per office; further lounges become reading corners.
    if (it.has("bookshelves")) it.wallRun(z, ["bookshelf"], "left");
    if (it.has("seating")) seated = !!it.fit(z, { w: 2, h: 1, make: (x, y) => [{ kind: "armchair", tx: x, ty: y, interact: "sofa" }, { kind: "lamp", tx: x + 1, ty: y }] }, "top");
    if (it.has("music") && !it.placed("music")) it.wallRun(z, ["record-player"], "right");
    if (seated && !z.catchAll) z.room.name = "Reading corner";
    return seated;
  }
  if (it.has("fireplace") && homey && !it.placed("fireplace") && it.wallRun(z, ["fireplace"], "left")) {
    seated = !!it.fit(z, fireGroup({ rug: it.has("rugs"), cat: it.has("cat") && !it.placed("cat") }), "top");
  }
  if (!seated && it.has("seating")) seated = loungeIn(c, z);
  if (it.has("music")) it.wallRun(z, ["record-player"], "right");
  if (it.has("bookshelves")) it.wallRun(z, ["bookshelf"], "left");
  it.wallItem(z, "string-lights", 2);
  return seated;
}

function loungeIn(c: Ctx, z: Zone, prefer: "top" | "center" = "top") {
  const { it } = c;
  const opts = { rug: it.has("rugs"), lamp: it.has("lamps"), cat: it.has("cat") && !it.placed("cat") };
  return !!(it.fit(z, loungeGroup({ ...opts, compact: false }), prefer) || it.fit(z, loungeGroup({ ...opts, compact: true }), prefer));
}

function kitchen(c: Ctx, z: Zone) {
  const { it } = c;
  let done = false;
  if (it.has("kitchen")) {
    done = KITCHEN_RUNS.some((run) => it.wallRun(z, run, "left"));
    if (!done) {
      // No back wall here (an open-plan island): a freestanding counter with stools in front.
      const island: Group = {
        w: 4,
        h: 2,
        make: (x, y) => [
          { kind: "counter", tx: x, ty: y },
          { kind: "sink", tx: x + 1, ty: y },
          { kind: "coffee-machine", tx: x + 2, ty: y, interact: "coffee" },
          { kind: "fridge", tx: x + 3, ty: y, interact: "fridge" },
          ...[0, 1, 2, 3].map((i) => ({ kind: "stool" as const, tx: x + i, ty: y + 1 })),
        ],
      };
      done = !!it.fit(z, island, "center");
    }
    if (done && z.area > 30) it.wallRun(z, ["water-cooler"], "right");
  }
  if (it.has("tables")) {
    const tables = Math.max(1, Math.min(3, Math.floor(it.freeCount(z) / 18)));
    for (let i = 0; i < tables; i++) if (it.fit(z, CAFE, "center")) done = true;
  }
  it.wallItem(z, "string-lights", 2);
  return done;
}

function meeting(c: Ctx, z: Zone) {
  const { it } = c;
  if (!it.has("meeting")) return false;
  const at = it.fit(z, meetingGroup(it.has("rugs")), "center");
  if (!at) {
    // Too small for the big table: a round table for two.
    const small: Group = { w: 4, h: 2, make: (x, y) => [{ kind: "chair", tx: x + 1, ty: y }, { kind: "chair", tx: x + 2, ty: y }, { kind: "round-table", tx: x + 1, ty: y + 1, interact: "meeting" }] };
    const s = it.fit(z, small, "center");
    if (!s) return false;
    it.wallItem(z, "tv", 2, s.x + 2);
    return true;
  }
  it.wallItem(z, "tv", 2, at.x + 3);
  it.wallItem(z, "whiteboard", 2);
  return true;
}

function entrance(c: Ctx, z: Zone) {
  const { it } = c;
  let any = false;
  if (it.has("desks")) any = !!it.fit(z, RECEPTION, "center");
  if (it.has("seating")) any = !!it.fit(z, NOOK, "top") || any;
  if (it.has("plants")) {
    const mat = it.b.objects.find((o) => o.kind === "mat" && z.mask[o.ty]?.[o.tx]);
    if (mat) for (const x of [mat.tx - 2, mat.tx + (mat.w ?? 2) + 1]) it.put({ kind: "plant", tx: x, ty: mat.ty, interact: "plant" }, z);
  }
  it.wallItem(z, "notice-board", 2);
  return any;
}

function quiet(c: Ctx, z: Zone) {
  const { it } = c;
  let any = false;
  if (it.has("desks")) any = it.placeDesks(z, it.pickDesks(z, Math.min(4, Math.max(2, Math.floor(z.area / 25))), false), "quiet-desk") > 0;
  if (it.has("bookshelves")) it.wallRun(z, ["bookshelf"], "left");
  if (it.has("lamps")) it.wallRun(z, ["lamp"], "right");
  it.wallItem(z, "clock");
  return any;
}

/** A booth: one desk against the far wall, chair facing it, centred. */
function call(c: Ctx, z: Zone) {
  const { it } = c;
  if (!it.has("desks") || z.x1 - z.x0 < 1 || z.y1 - z.y0 < 1) return false;
  const x = z.x0 + Math.floor((z.x1 - z.x0 + 1 - 2) / 2);
  it.relaxDoors = true;
  let ok = false;
  for (let y = z.y1; y > z.y0 && !ok; y--) ok = it.placeDesks(z, [{ x, y }], "call-booth") > 0;
  it.relaxDoors = false;
  return ok;
}

function bedroom(c: Ctx, z: Zone) {
  const { it } = c;
  if (!it.has("bed")) return false;
  const ok = it.wallRun(z, it.has("lamps") ? ["lamp", "bed"] : ["bed"], "left");
  if (ok && it.has("rugs")) {
    const bed = it.b.objects.find((o) => o.kind === "bed" && z.mask[o.ty]?.[o.tx]);
    if (bed) it.putAll([{ kind: "rug", tx: bed.tx - 1, ty: bed.ty + 2, w: 4, h: 2 }], z);
  }
  if (it.has("bookshelves")) it.wallRun(z, ["bookshelf"], "right");
  return ok;
}

function library(c: Ctx, z: Zone) {
  const { it } = c;
  if (!it.has("bookshelves")) return false;
  while (it.wallRun(z, ["bookshelf"], "left"));
  // Freestanding stacks with aisles between them.
  const stack: Group = { w: 4, h: 1, make: (x, y) => [0, 2].map((i) => ({ kind: "bookshelf" as const, tx: x + i, ty: y, interact: "bookshelf" as InteractionId })) };
  it.fit(z, stack, "center");
  if (it.has("seating")) it.fit(z, { w: 2, h: 1, make: (x, y) => [{ kind: "armchair", tx: x, ty: y, interact: "sofa" }, { kind: "lamp", tx: x + 1, ty: y }] }, "bottom");
  return true;
}

function greenhouse(c: Ctx, z: Zone) {
  const { it } = c;
  if (!it.has("plants")) return false;
  for (let y = z.y0; y <= z.y1; y += 2) for (let x = z.x0; x <= z.x1; x += 2) it.put({ kind: (x + y) % 4 ? "plant" : "small-plant", tx: x, ty: y, interact: "plant" }, z);
  return true;
}

/** Extras for work space once the desks are in. */
function workExtras(c: Ctx, z: Zone, hasMeetingRoom: boolean) {
  const { it } = c;
  const grass = it.b.floor[Math.floor((z.y0 + z.y1) / 2)]?.[Math.floor((z.x0 + z.x1) / 2)] === "grass";
  if (grass) {
    if (it.has("tables")) it.fit(z, PICNIC, "bottom");
    if (it.has("plants")) for (let x = z.x0; x <= z.x1; x += 5) it.put({ kind: "tree", tx: x, ty: z.y0, interact: "plant" }, z);
    return;
  }
  if (it.has("bookshelves")) it.wallRun(z, ["bookshelf"], "left");
  if (it.has("kitchen")) it.wallRun(z, ["water-cooler"], "right");
  if (it.has("office") && (c.layout === "open-plan" || z.area > 90)) it.wallRun(z, ["copier", "bin"], "right");
  if (!hasMeetingRoom) it.wallItem(z, "whiteboard", 2);
  it.wallItem(z, "notice-board", 2);
  it.wallItem(z, "clock");
  it.wallItem(z, "string-lights", 2);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function arrange(b: Builder, config: OfficeConfig, spawn: { tx: number; ty: number }, rand: () => number) {
  const theme = b.theme;
  const defs = catalog(theme) as Defs;
  // The plan built the building; furniture is planned here from scratch. Door mats stay.
  const keep = b.objects.filter((o) => o.kind === "mat");
  b.objects.length = 0;
  b.objects.push(...keep);

  const it = new Interior(b, defs, { x: Math.floor(spawn.tx), y: Math.floor(spawn.ty) }, config.features);
  const c: Ctx = { it, layout: config.layout, style: config.workspaceStyle, rand, lounges: 0 };
  const byRole = (r: Role) => it.zones.filter((z) => z.role === r);
  const used = new Set<Zone>();

  /* Desks first, so the team gets the best space. */
  if (it.has("desks")) {
    const team = Math.max(tierOf(config.teamSize).desks, 1 + config.teammates.length);
    const cubicles = config.layout === "open-plan";
    const work = byRole("work").sort((p, q) => Number(p.catchAll) - Number(q.catchAll) || q.area - p.area);
    let placed = 0;
    for (const z of [...work, ...byRole("quiet"), ...[...it.zones].sort((p, q) => q.area - p.area)]) {
      if (placed >= team) break;
      if (z.role === "call" || z.role === "bedroom" || z.role === "entrance") continue;
      const n = it.placeDesks(z, it.pickDesks(z, team - placed, cubicles), "desk", placed, cubicles);
      if (n) used.add(z);
      placed += n;
    }
  }

  /* Then each room by its role. */
  const recipes: Partial<Record<Role, (c: Ctx, z: Zone) => boolean>> = {
    entrance,
    meeting,
    kitchen,
    lounge,
    bedroom,
    library,
    quiet,
    call,
    greenhouse,
  };
  for (const role of ["entrance", "meeting", "kitchen", "bedroom", "library", "lounge", "quiet", "call", "greenhouse"] as Role[]) {
    for (const z of byRole(role)) if (recipes[role]!(c, z)) used.add(z);
  }
  const hasMeeting = it.placed("meeting");
  for (const z of byRole("work")) workExtras(c, z, hasMeeting);
  for (const z of byRole("hall")) it.wallItem(z, "notice-board", 2);

  /* Anything ticked that found no room of its own goes into the emptiest suitable room. */
  const hosts = () =>
    it.zones
      .filter((z) => !["call", "bedroom", "greenhouse"].includes(z.role) && z.area >= 16)
      .sort((p, q) => Number(used.has(p)) - Number(used.has(q)) || it.freeCount(q) - it.freeCount(p));
  const rename = (z: Zone, name: string) => {
    if (!used.has(z) && !z.catchAll) z.room.name = name;
    used.add(z);
  };
  const homeless: [FeatureId, string, (z: Zone) => boolean][] = [
    ["seating", "Lounge", (z) => loungeIn(c, z, "center")],
    ["meeting", "Meeting area", (z) => meeting(c, z)],
    ["kitchen", "Kitchenette", (z) => KITCHEN_RUNS.some((run) => it.wallRun(z, run, "right"))],
    ["tables", "Café corner", (z) => !!it.fit(z, CAFE, "center")],
    ["bookshelves", "Reading corner", (z) => it.wallRun(z, ["bookshelf"], "left")],
    ["music", "Lounge", (z) => it.wallRun(z, ["record-player"], "right")],
  ];
  for (const [feature, name, place] of homeless) {
    if (!it.has(feature) || it.placed(feature)) continue;
    for (const z of hosts()) if (place(z)) {
      rename(z, name);
      break;
    }
  }

  /* Rooms left (nearly) empty get a second helping of something the user picked. */
  for (const z of it.zones) {
    if (used.has(z) || z.area < 20 || ["call", "hall", "entrance"].includes(z.role) || it.contents(z).length > 1) continue;
    if (it.has("seating") && loungeIn(c, z, "center")) rename(z, "Lounge");
    else if (it.has("tables") && it.fit(z, CAFE, "center")) {
      it.fit(z, CAFE, "center");
      rename(z, "Café corner");
    } else if (it.has("bookshelves") && it.wallRun(z, ["bookshelf", "bookshelf"], "left")) rename(z, "Reading corner");
  }

  /* The cat curls up on a rug if there is one. */
  if (it.has("cat") && !it.placed("cat")) {
    const spot = b.objects.find((o) => o.kind === "rug");
    const zone = it.zones.find((z) => spot && z.mask[spot.ty]?.[spot.tx]) ?? it.zones[0];
    if (spot) it.put({ kind: "cat", tx: spot.tx + (spot.w ?? 1) - 1, ty: spot.ty, interact: "cat" }, zone);
  }

  sign(it, theme, config.workspaceName);
  decorate(it, DECOR[config.workspaceStyle], rand);
}

/* ------------------------------------------------------------------ */
/* Finishing touches                                                   */
/* ------------------------------------------------------------------ */

const WALL_WIDTH: Partial<Record<Kind, number>> = { "wall-shelf": 2 };

/** Style-driven dressing, only from ticked features: a cabinet, corner plants or lamps, wall pieces. */
function decorate(it: Interior, style: StyleDecor, rand: () => number) {
  const allow = (k: Kind) => {
    const f = FEATURE_OF.get(k);
    return !f || it.has(f);
  };
  const cornerKinds = style.cornerKinds.filter(allow);
  const wallKinds = style.wall.filter(allow);
  const dressable = it.zones.filter((z) => !["call", "greenhouse"].includes(z.role));

  for (const z of dressable) {
    /* One low cabinet on a long bare wall in living spaces. */
    if (allow("sideboard") && ["work", "lounge", "entrance", "hall", "quiet"].includes(z.role) && z.area >= 30 && rand() < style.sideboard) it.wallRun(z, ["sideboard"], "center");

    /* A few free corners get a plant or lamp. */
    if (cornerKinds.length) {
      let n = 0;
      const max = z.area >= 60 ? 3 : z.area >= 20 ? 2 : 1;
      for (let y = z.y0; y <= z.y1 && n < max; y++)
        for (let x = z.x0; x <= z.x1 && n < max; x++) {
          if (!it.free(x, y, z)) continue;
          const vertical = it.space.wall(x, y - 1) || it.space.wall(x, y + 1);
          const side = it.space.wall(x - 1, y) || it.space.wall(x + 1, y);
          if (!vertical || !side || rand() >= style.corner) continue;
          let crowded = false;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && !it.space.wall(x + i, y + j) && !it.free(x + i, y + j)) crowded = true;
          if (crowded) continue;
          const f = it.b.floor[y][x];
          let kind = cornerKinds[(x + y) % cornerKinds.length];
          // Floor lamps only where people sit and read; elsewhere a plant.
          if (kind === "lamp" && !["lounge", "entrance", "quiet"].includes(z.role)) kind = cornerKinds.find((k) => k !== "lamp") ?? kind;
          if (kind === "lamp" && !["lounge", "entrance", "quiet"].includes(z.role)) continue;
          if (f === "grass" && allow("tree")) kind = "tree";
          if (it.put({ kind, tx: x, ty: y, interact: kind === "lamp" ? undefined : "plant" }, z)) n++;
        }
    }
  }

  /* Wall pieces along each zone's back wall, spaced by style. */
  if (!wallKinds.length) return;
  let k = Math.floor(rand() * wallKinds.length);
  for (const z of dressable) {
    const pieces = Math.max(1, Math.floor((z.x1 - z.x0 + 1) / (style.wallGap + 3)));
    for (let i = 0; i < pieces; i++) {
      const kind = wallKinds[k++ % wallKinds.length];
      const frames = it.defs[kind]?.frames.length ?? 1;
      const x = z.x0 + ((i + 0.5) * (z.x1 - z.x0 + 1)) / pieces;
      it.wallItem(z, kind, WALL_WIDTH[kind] ?? 1, x, frames > 1 ? Math.floor(rand() * frames) : undefined);
    }
  }
}

/** Hang the workspace name on the wall above the reception (or the main work room). */
function sign(it: Interior, theme: Theme, name: string) {
  const w = Math.ceil(signFrame(name, theme.deskExtra)[0].length / 16);
  const reception = it.b.objects.find((o) => o.kind === "reception");
  const zones = [...it.zones].sort((p, q) => Number(q.role === "work" && !q.catchAll) - Number(p.role === "work" && !p.catchAll) || q.area - p.area);
  const host = (reception && it.zones.find((z) => z.mask[reception.ty]?.[reception.tx])) || zones[0];
  if (!host) return;
  if (!it.wallItem(host, "sign", w, reception ? reception.tx + 1.5 : undefined)) for (const z of zones) if (z !== host && it.wallItem(z, "sign", w)) break;
}
