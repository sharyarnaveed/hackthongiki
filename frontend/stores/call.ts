"use client";

import { create } from "zustand";

export type CallKind = "video" | "voice";

interface CallState {
  inCall: boolean;
  kind: CallKind;
  muted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  chatOpen: boolean;
  participantIds: string[];
  speakingId: string | null;
  join: (participantIds: string[], kind?: CallKind) => void;
  leave: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleShare: () => void;
  toggleChat: () => void;
  setKind: (k: CallKind) => void;
  setSpeaking: (id: string | null) => void;
}

export const useCall = create<CallState>()((set) => ({
  inCall: false,
  kind: "video",
  muted: false,
  cameraOn: true,
  sharing: false,
  chatOpen: false,
  participantIds: [],
  speakingId: null,
  join: (participantIds, kind = "video") =>
    set({ inCall: true, participantIds, kind, cameraOn: kind === "video", sharing: false }),
  leave: () => set({ inCall: false, participantIds: [], sharing: false, speakingId: null }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleCamera: () => set((s) => ({ cameraOn: !s.cameraOn })),
  toggleShare: () => set((s) => ({ sharing: !s.sharing })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setKind: (kind) => set({ kind, cameraOn: kind === "video" }),
  setSpeaking: (speakingId) => set({ speakingId }),
}));
