"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Mode, ThemePref } from "@/lib/types";
import { UI_STORAGE_KEY_CONST as UI_STORAGE_KEY } from "@/components/shell/theme-constants";

interface UIState {
  mode: Mode;
  theme: ThemePref;
  sidebarCollapsed: boolean;
  notifications: { messages: boolean; calls: boolean; approvals: boolean; sounds: boolean };
  setMode: (m: Mode) => void;
  setTheme: (t: ThemePref) => void;
  toggleSidebar: () => void;
  setNotification: (k: keyof UIState["notifications"], v: boolean) => void;
}

export { UI_STORAGE_KEY };

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      mode: "office",
      theme: "system",
      sidebarCollapsed: false,
      notifications: { messages: true, calls: true, approvals: true, sounds: false },
      setMode: (mode) => set({ mode }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setNotification: (k, v) => set((s) => ({ notifications: { ...s.notifications, [k]: v } })),
    }),
    {
      name: UI_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ mode, theme, sidebarCollapsed, notifications }) => ({ mode, theme, sidebarCollapsed, notifications }),
    },
  ),
);
