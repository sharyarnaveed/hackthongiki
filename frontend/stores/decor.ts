"use client";

import { create } from "zustand";
import type { PlacedItem, Rotation } from "@/lib/types";

interface DecorState {
  editing: boolean;
  placed: PlacedItem[];
  /** snapshot to restore on cancel */
  original: PlacedItem[];
  selectedId: string | null;
  /** inventory item currently being dragged onto the grid */
  draggingItemId: string | null;
  load: (placed: PlacedItem[]) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  finishEditing: () => void;
  select: (instanceId: string | null) => void;
  setDragging: (itemId: string | null) => void;
  place: (p: PlacedItem) => void;
  move: (instanceId: string, x: number, y: number) => void;
  rotate: (instanceId: string) => void;
  remove: (instanceId: string) => void;
}

const next: Record<Rotation, Rotation> = { 0: 90, 90: 180, 180: 270, 270: 0 };

export const useDecor = create<DecorState>()((set) => ({
  editing: false,
  placed: [],
  original: [],
  selectedId: null,
  draggingItemId: null,
  load: (placed) => set({ placed, original: placed }),
  startEditing: () => set((s) => ({ editing: true, original: s.placed })),
  cancelEditing: () => set((s) => ({ editing: false, placed: s.original, selectedId: null })),
  finishEditing: () => set((s) => ({ editing: false, original: s.placed, selectedId: null })),
  select: (selectedId) => set({ selectedId }),
  setDragging: (draggingItemId) => set({ draggingItemId }),
  place: (p) => set((s) => ({ placed: [...s.placed, p], selectedId: p.instanceId })),
  move: (id, x, y) => set((s) => ({ placed: s.placed.map((p) => (p.instanceId === id ? { ...p, x, y } : p)) })),
  rotate: (id) =>
    set((s) => ({ placed: s.placed.map((p) => (p.instanceId === id ? { ...p, rotation: next[p.rotation] } : p)) })),
  remove: (id) => set((s) => ({ placed: s.placed.filter((p) => p.instanceId !== id), selectedId: null })),
}));
