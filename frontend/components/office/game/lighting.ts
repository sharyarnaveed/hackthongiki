import type { ObjectDef } from "./furniture";
import type { OfficeMap } from "./map";
import { T, TILE } from "./tiles";

/**
 * A map-sized RGBA overlay drawn over the floor and under the furniture:
 * contact shadows along walls and under every piece of furniture, sunlight
 * falling in from the windows, and warm pools of light around lamps and the
 * fire. Pure (no DOM), so it can be painted on the loading screen and tested.
 *
 * Alphas are stepped rather than smooth so the result still reads as pixel art.
 */

export interface Overlay {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export type SpriteInfo = Pick<ObjectDef, "footprint" | "layer"> & { w: number; h: number };

const SHADOW: [number, number, number] = [29, 21, 12];
const SUN: [number, number, number] = [255, 243, 200];
const LAMP: [number, number, number] = [255, 214, 140];

/** Objects that throw a pool of warm light, with its radius in pixels. */
const LIGHTS: Partial<Record<string, number>> = { lamp: 30, "side-table": 24, fireplace: 40, "string-lights": 22, "coffee-machine": 10 };

export function paintLighting(map: OfficeMap, sprites: Record<string, SpriteInfo>): Overlay {
  const W = map.width * TILE;
  const H = map.height * TILE;
  const data = new Uint8ClampedArray(W * H * 4);
  const isWall = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= map.width || ty >= map.height || map.walls[ty][tx];

  /** Source-over blend of one pixel, skipped on walls so shading stays on the floor. */
  const blend = (x: number, y: number, [r, g, b]: [number, number, number], a: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    if (isWall(Math.floor(x / TILE), Math.floor(y / TILE))) return;
    const i = (y * W + x) * 4;
    const da = data[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (const [k, c] of [[0, r], [1, g], [2, b]] as const) data[i + k] = (c * a + data[i + k] * da * (1 - a)) / oa;
    data[i + 3] = oa * 255;
  };
  const rect = (x: number, y: number, w: number, h: number, c: [number, number, number], a: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) blend(i, j, c, a);
  };

  /* Sunlight under each window, slanting right as it falls across the floor. */
  for (const wx of windowColumns(map)) {
    for (let row = 0; row < 44; row++) {
      const y = 2 * TILE + row;
      if (isWall(wx, Math.floor(y / TILE))) break;
      const a = row < 12 ? 0.16 : row < 26 ? 0.11 : row < 36 ? 0.07 : 0.04;
      rect(wx * TILE + 2 + Math.floor(row / 3), y, 12, 1, SUN, a);
    }
  }

  /* Warm light pools. */
  for (const o of map.objects) {
    const r = LIGHTS[o.kind];
    if (!r) continue;
    const s = sprites[o.kind];
    const fw = s?.footprint?.w ?? o.w ?? 1;
    const cx = o.tx * TILE + (fw * TILE) / 2;
    const cy = s?.layer === "wall" ? (o.ty + 1) * TILE + 6 : (o.ty + 1) * TILE - 2;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        // Squash vertically: light on a floor seen at an angle.
        const d = Math.hypot(x - cx, (y - cy) * 1.5);
        const a = d < r * 0.4 ? 0.16 : d < r * 0.7 ? 0.1 : d < r ? 0.05 : 0;
        blend(x, y, LAMP, a);
      }
  }

  /* Contact shadows where the floor meets a wall. */
  for (let ty = 0; ty < map.height; ty++)
    for (let tx = 0; tx < map.width; tx++) {
      if (isWall(tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (isWall(tx, ty - 1)) [0.3, 0.2, 0.12, 0.06].forEach((a, i) => rect(x, y + i, TILE, 1, SHADOW, a));
      if (isWall(tx - 1, ty)) [0.18, 0.08].forEach((a, i) => rect(x + i, y, 1, TILE, SHADOW, a));
      if (isWall(tx + 1, ty)) rect(x + TILE - 1, y, 1, TILE, SHADOW, 0.1);
    }

  /* Furniture: a soft rounded shadow under each base, nudged right (light from the windows, upper left). */
  for (const o of map.objects) {
    const s = sprites[o.kind === "rug" ? "" : o.kind];
    if (!s || s.layer !== "sort") continue;
    const fw = s.footprint?.w ?? o.w ?? 1;
    const x = o.tx * TILE + Math.round((fw * TILE - s.w) / 2);
    const bottom = (o.ty + 1) * TILE;
    const small = !s.footprint;
    const core = small ? 0.16 : 0.24;
    const w = s.w - 2;
    const top = bottom - (small ? 2 : 4);
    for (let j = top; j < bottom + 2; j++) {
      const inset = j === top || j === bottom + 1 ? 2 : 0;
      const a = j >= bottom ? core * 0.5 : core;
      rect(x + 2 + inset, j, w - inset * 2, 1, SHADOW, a);
    }
  }

  return { width: W, height: H, data };
}

/** Columns of the windows in the top wall (window tiles sit in row 1). */
function windowColumns(map: OfficeMap) {
  const cols: number[] = [];
  map.tiles[1]?.forEach((t, x) => {
    if (t === T.WINDOW || t === T.BRICK_WINDOW) cols.push(x);
  });
  return cols;
}
