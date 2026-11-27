import type { DecorItem, PlacedItem, Rotation } from "@/lib/types";

export interface Rect { x: number; y: number; w: number; h: number }

/** Footprint in tiles after rotation (90/270 swap w and h). */
export function footprint(item: Pick<DecorItem, "w" | "h">, rotation: Rotation): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: item.h, h: item.w } : { w: item.w, h: item.h };
}

export function rectOf(p: PlacedItem, item: Pick<DecorItem, "w" | "h">): Rect {
  return { x: p.x, y: p.y, ...footprint(item, p.rotation) };
}

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const inBounds = (r: Rect, cols: number, rows: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows;

/** Pixel offset → tile index, clamped so the footprint stays on the grid. */
export function snap(px: number, tile: number, span: number, max: number): number {
  const t = Math.round(px / tile);
  return Math.max(0, Math.min(max - span, t));
}

/** Can `candidate` sit at its x/y without leaving the grid or hitting others? */
export function canPlace(
  candidate: PlacedItem,
  placed: PlacedItem[],
  items: Record<string, Pick<DecorItem, "w" | "h">>,
  cols: number,
  rows: number,
): boolean {
  const item = items[candidate.itemId];
  if (!item) return false;
  const r = rectOf(candidate, item);
  if (!inBounds(r, cols, rows)) return false;
  return placed.every((p) => {
    if (p.instanceId === candidate.instanceId) return true;
    const other = items[p.itemId];
    return !other || !overlaps(r, rectOf(p, other));
  });
}

/** First free spot scanning row by row, or null. */
export function findFreeSpot(
  itemId: string,
  placed: PlacedItem[],
  items: Record<string, Pick<DecorItem, "w" | "h">>,
  cols: number,
  rows: number,
): { x: number; y: number } | null {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const c: PlacedItem = { instanceId: "__probe", itemId, x, y, rotation: 0 };
      if (canPlace(c, placed, items, cols, rows)) return { x, y };
    }
  return null;
}
