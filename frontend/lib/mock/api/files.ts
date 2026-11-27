import type { FileItem, FileKind } from "@/lib/types";
import { db } from "../db";
import { CURRENT_USER_ID } from "../data/users";
import { clone, iso, sleep, uid } from "../delay";

export async function listFiles(workspaceId: string): Promise<FileItem[]> {
  await sleep();
  return clone(db.files.filter((f) => f.workspaceId === workspaceId));
}

const kindFromName = (name: string): FileKind => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "key"].includes(ext)) return "slide";
  if (ext === "pdf") return "pdf";
  if (["zip", "rar", "7z"].includes(ext)) return "zip";
  if (["ts", "tsx", "js", "py", "go", "rs"].includes(ext)) return "code";
  return "doc";
};

/** Fake upload: reports progress, then stores metadata only. */
export async function uploadFile(
  workspaceId: string,
  file: { name: string; size: number },
  onProgress?: (pct: number) => void,
): Promise<FileItem> {
  for (let p = 0; p <= 100; p += 20) {
    onProgress?.(p);
    await sleep(120, 220);
  }
  const item: FileItem = {
    id: uid("f"), workspaceId, name: file.name, kind: kindFromName(file.name),
    sizeBytes: file.size, ownerId: CURRENT_USER_ID, updatedAt: iso(),
  };
  db.files.unshift(item);
  return clone(item);
}

export async function deleteFile(id: string): Promise<void> {
  await sleep();
  db.files = db.files.filter((f) => f.id !== id);
}
