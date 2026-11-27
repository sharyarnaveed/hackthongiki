"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User } from "@/lib/types";

interface SessionState {
  user: User | null;
  onboarded: boolean;
  partnerLinked: boolean;
  workspaceId: string | null;
  devices: { cameraId: string; micId: string; speakerId: string };
  signIn: (u: User) => void;
  signOut: () => void;
  completeOnboarding: () => void;
  setPartnerLinked: (v: boolean) => void;
  setWorkspace: (id: string | null) => void;
  setDevice: (k: keyof SessionState["devices"], id: string) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      onboarded: false,
      partnerLinked: true,
      workspaceId: "w1",
      devices: { cameraId: "cam-1", micId: "mic-1", speakerId: "spk-1" },
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null, onboarded: false }),
      completeOnboarding: () => set({ onboarded: true }),
      setPartnerLinked: (partnerLinked) => set({ partnerLinked }),
      setWorkspace: (workspaceId) => set({ workspaceId }),
      setDevice: (k, id) => set((s) => ({ devices: { ...s.devices, [k]: id } })),
    }),
    { name: "vo-session", storage: createJSONStorage(() => localStorage) },
  ),
);
