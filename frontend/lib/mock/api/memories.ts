import type { Memory } from "@/lib/types";
import { db } from "../db";
import { COUPLE_ID } from "../data/couple";
import { CURRENT_USER_ID } from "../data/users";
import { clone, sleep, uid } from "../delay";

const palette = [
  ["#f6a6a1", "#f9d89c"], ["#9ad3e6", "#f7e1b5"], ["#c7b8ea", "#f2c6de"], ["#b9d8b0", "#f5e6a8"],
];

export async function listMemories(): Promise<Memory[]> {
  await sleep();
  return clone([...db.memories].sort((a, b) => b.date.localeCompare(a.date)));
}

export async function addMemory(input: Pick<Memory, "title" | "note" | "emoji" | "date">): Promise<Memory> {
  await sleep(400, 700);
  const [a, b] = palette[Math.floor(Math.random() * palette.length)];
  const m: Memory = {
    ...input, id: uid("mem"), coupleId: COUPLE_ID, authorId: CURRENT_USER_ID,
    gradient: `linear-gradient(135deg, ${a}, ${b})`,
  };
  db.memories.push(m);
  return clone(m);
}

export async function deleteMemory(id: string): Promise<void> {
  await sleep();
  db.memories = db.memories.filter((m) => m.id !== id);
}
