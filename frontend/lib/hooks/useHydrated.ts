"use client";

import { useSyncExternalStore } from "react";

/** true after the first client render — use to avoid SSR/localStorage mismatches. */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
