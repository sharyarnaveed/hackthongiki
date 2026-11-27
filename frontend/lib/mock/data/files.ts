import type { FileItem } from "@/lib/types";
import { iso } from "../delay";

export const files: FileItem[] = [
  { id: "f1", workspaceId: "w1", name: "Q4 Roadmap.pdf", kind: "pdf", sizeBytes: 2_400_000, ownerId: "u4", updatedAt: iso(1) },
  { id: "f2", workspaceId: "w1", name: "Office floor v3.png", kind: "image", sizeBytes: 840_000, ownerId: "u1", updatedAt: iso(0, 3) },
  { id: "f3", workspaceId: "w1", name: "Sprint metrics.xlsx", kind: "sheet", sizeBytes: 120_000, ownerId: "u2", updatedAt: iso(2) },
  { id: "f4", workspaceId: "w1", name: "Launch deck.key", kind: "slide", sizeBytes: 15_200_000, ownerId: "u8", updatedAt: iso(4) },
  { id: "f5", workspaceId: "w1", name: "Onboarding guide.docx", kind: "doc", sizeBytes: 310_000, ownerId: "u4", updatedAt: iso(9) },
  { id: "f6", workspaceId: "w1", name: "Demo recording.mp4", kind: "video", sizeBytes: 98_000_000, ownerId: "u3", updatedAt: iso(6) },
  { id: "f7", workspaceId: "w1", name: "brand-assets.zip", kind: "zip", sizeBytes: 44_000_000, ownerId: "u8", updatedAt: iso(14) },
  { id: "f8", workspaceId: "w1", name: "room-presence.ts", kind: "code", sizeBytes: 8_200, ownerId: "u5", updatedAt: iso(0, 6) },
  { id: "f9", workspaceId: "w2", name: "Pitch notes.docx", kind: "doc", sizeBytes: 54_000, ownerId: "u1", updatedAt: iso(3) },
];
