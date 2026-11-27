import type { Frame } from "@/components/pixel/grid";
import { Px } from "@/components/pixel/painter";

export const TILE = 16;

/** Tileset indices. Wall caps occupy 16 slots, one per open-side mask. */
export const T = {
  WOOD_A: 0,
  WOOD_B: 1,
  CARPET: 2,
  KITCHEN: 3,
  FACE: 4,
  WINDOW: 5,
  BLOCK: 6,
  CAP: 7, // 7..22
  TILES: 23,
  CONCRETE: 24,
  BRICK: 25,
  BRICK_WINDOW: 26,
  GRASS: 27,
  WOOD_C: 28,
  WOOD_D: 29,
  GRASS_FLOWERS: 30,
  CONCRETE_B: 31,
  CARPET_B: 32,
} as const;

/** Floor variants a cell can pick from (by a stable hash), so large floors don't look stamped. */
export const WOOD_VARIANTS = [T.WOOD_A, T.WOOD_B, T.WOOD_C, T.WOOD_D];

/** Open-side bits for wall caps: which neighbours are not walls. */
export const OPEN = { N: 1, E: 2, S: 4, W: 8 } as const;

/**
 * Wood planks, 4px tall. Each row has its own end joint, and `tones` picks
 * which rows use the alternate plank colour so neighbouring tiles differ.
 */
function wood(offset: number, tones: number[]): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "1");
  for (let r = 0; r < 4; r++) {
    const y = r * 4;
    const seam = (r * 7 + offset) % TILE;
    if (tones.includes(r)) p.rect(0, y, seam, 3, "J");
    p.hline(0, y + 3, TILE, "2");
    p.vline(seam, y, 3, "2");
    // grain
    p.hline((seam + 3) % 12, y + 1, 3, "3");
    p.px((seam + 10) % TILE, y + 1, "J");
    p.px((seam + 12) % TILE, y + 2, "3");
  }
  return p.frame();
}

function carpet(alt = false): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "9");
  for (let y = 0; y < TILE; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < TILE; x += 4) p.px(x + 1, y + 1, "0");
  if (alt) p.px(6, 9, "H").px(13, 2, "H").px(3, 14, "H");
  return p.frame();
}

function kitchen(): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "K");
  p.rect(8, 0, 8, 8, "L").rect(0, 8, 8, 8, "L");
  p.px(1, 1, "w").px(9, 9, "w");
  return p.frame();
}

/** Large office floor tiles with grout lines and a soft sheen. */
function floorTiles(): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "1");
  p.hline(0, 15, TILE, "2").vline(15, 0, TILE, "2");
  p.hline(1, 1, 5, "3").vline(1, 1, 4, "3").px(3, 3, "3");
  return p.frame();
}

function concrete(alt = false): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "1");
  const specks = alt ? [[4, 2], [12, 4], [7, 8], [2, 11], [14, 12], [9, 14]] : [[2, 3], [9, 1], [13, 7], [5, 10], [11, 13], [1, 14]];
  specks.forEach(([x, y], i) => p.px(x, y, i % 2 ? "3" : "2"));
  if (alt) p.hline(5, 6, 4, "3");
  p.hline(0, 15, TILE, "2");
  return p.frame();
}

/** Garden lawn with a few darker blades; the alternate has tiny flowers. */
function grass(flowers = false): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "l");
  [[2, 3], [9, 1], [13, 7], [5, 10], [11, 13], [1, 13], [7, 6]].forEach(([x, y], i) => p.px(x, y, "g").px(x + (i % 2 ? 1 : -1), y - 1, "g"));
  if (flowers) {
    p.px(4, 5, "P").px(3, 5, "y").px(5, 5, "y").px(4, 4, "y").px(4, 6, "y");
    p.px(12, 11, "P").px(11, 11, "n").px(13, 11, "n").px(12, 10, "n").px(12, 12, "n");
  }
  return p.frame();
}

function brick(): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "4");
  p.hline(0, 0, TILE, "7");
  for (let row = 0; row < 3; row++) {
    const y = 1 + row * 4;
    p.hline(0, y + 3, TILE, "5");
    const off = row % 2 ? 4 : 0;
    for (let x = off; x < TILE; x += 8) p.vline(x, y, 3, "5");
    p.px(off + 2, y, "W");
  }
  p.rect(0, 13, TILE, 2, "8").hline(0, 15, TILE, "k");
  return p.frame();
}

/** Painted wall: a shaded strip under the cap, plain upper wall, a rail and wainscot panels, then the baseboard. */
function face(): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "4");
  p.hline(0, 0, TILE, "7").hline(0, 1, TILE, "5");
  p.hline(0, 2, TILE, "W");
  p.hline(0, 7, TILE, "W").hline(0, 8, TILE, "5");
  p.rect(0, 9, TILE, 4, "E").vline(7, 9, 4, "5").vline(15, 9, 4, "5").vline(8, 9, 4, "W").vline(0, 9, 4, "W");
  p.rect(0, 13, TILE, 2, "8").hline(0, 15, TILE, "k");
  return p.frame();
}

function windowTile(wall = face()): Frame {
  const p = new Px(TILE, TILE).stamp(wall);
  p.box(2, 2, 12, 10, "q", "k").rect(3, 3, 10, 8, "q");
  p.vline(7, 3, 8, "w").vline(8, 3, 8, "w").hline(3, 6, 10, "w");
  p.px(4, 4, "w").px(5, 4, "w").px(4, 5, "w").px(10, 8, "w");
  p.hline(1, 12, 14, "e").hline(1, 13, 14, "k");
  return p.frame();
}

/** Wall top seen from above: a bevelled edge on open sides and a faint inner line. */
function cap(mask: number): Frame {
  const p = new Px(TILE, TILE).rect(0, 0, TILE, TILE, "6");
  if (mask & OPEN.N) p.hline(0, 1, TILE, "C");
  if (mask & OPEN.W) p.vline(1, 0, TILE, "C");
  if (mask & OPEN.N) p.hline(0, 0, TILE, "7");
  if (mask & OPEN.S) p.hline(0, 15, TILE, "7");
  if (mask & OPEN.W) p.vline(0, 0, TILE, "7");
  if (mask & OPEN.E) p.vline(15, 0, TILE, "7");
  return p.frame();
}

/** Every tile frame, in tileset order. */
export function tileFrames(): Frame[] {
  const blank = new Px(TILE, TILE).frame();
  return [
    wood(3, [1]),
    wood(11, [3]),
    carpet(),
    kitchen(),
    face(),
    windowTile(),
    blank,
    ...Array.from({ length: 16 }, (_, m) => cap(m)),
    floorTiles(),
    concrete(),
    brick(),
    windowTile(brick()),
    grass(),
    wood(6, [0, 2]),
    wood(14, []),
    grass(true),
    concrete(true),
    carpet(true),
  ];
}
