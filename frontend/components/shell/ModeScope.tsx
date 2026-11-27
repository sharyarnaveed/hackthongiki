"use client";

import { useEffect } from "react";
import { useUI } from "@/stores/ui";
import type { Mode } from "@/lib/types";

/** Forces the app mode while a mode's routes are mounted. */
export function ModeScope({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  const setMode = useUI((s) => s.setMode);
  useEffect(() => setMode(mode), [mode, setMode]);
  return <>{children}</>;
}
