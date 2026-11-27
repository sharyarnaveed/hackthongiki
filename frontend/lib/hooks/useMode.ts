"use client";

import { useUI } from "@/stores/ui";
import type { Mode } from "@/lib/types";

/** Current app mode (office | home). Drives theme + component skins. */
export function useMode(): Mode {
  return useUI((s) => s.mode);
}

export const useIsHome = () => useMode() === "home";
