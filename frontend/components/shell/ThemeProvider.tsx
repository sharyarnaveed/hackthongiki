"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useUI } from "@/stores/ui";

const query = "(prefers-color-scheme: dark)";
function useSystemDark() {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Resolved dark flag for components that need it in JS (e.g. Toaster). */
export function useResolvedDark() {
  const theme = useUI((s) => s.theme);
  const systemDark = useSystemDark();
  return theme === "dark" || (theme === "system" && systemDark);
}

/** Mirrors the ui store onto <html data-mode> and the `dark` class. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useUI((s) => s.mode);
  const dark = useResolvedDark();

  useEffect(() => {
    const r = document.documentElement;
    r.dataset.mode = mode;
    r.classList.toggle("dark", dark);
    r.style.colorScheme = dark ? "dark" : "light";
  }, [mode, dark]);

  return <>{children}</>;
}
