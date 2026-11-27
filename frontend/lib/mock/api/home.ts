import type { Couple, DecorItem, House, PlacedItem, User } from "@/lib/types";
import { db } from "../db";
import { COUPLE_ID } from "../data/couple";
import { clone, sleep, uid } from "../delay";

export async function getCouple(): Promise<(Couple & { partners: User[] }) | null> {
  await sleep(150, 300);
  const c = db.couple;
  return clone({ ...c, partners: c.partnerIds.map((id) => db.users.find((u) => u.id === id)!) });
}

export async function generateInviteCode(): Promise<string> {
  await sleep(300, 500);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  db.couple.inviteCode = `${pick()}-${pick()}`;
  return db.couple.inviteCode;
}

export async function joinWithCode(code: string): Promise<boolean> {
  await sleep(600, 1000);
  if (code.trim().length < 6) throw new Error("That code doesn't look right");
  return true;
}

export async function getHouse(): Promise<House> {
  await sleep();
  return clone(db.house);
}

export async function saveLayout(placed: PlacedItem[]): Promise<House> {
  await sleep(300, 600);
  db.house.placed = clone(placed);
  return clone(db.house);
}

export async function moveAvatar(userId: string, x: number, y: number): Promise<void> {
  await sleep(50, 120);
  db.house.positions[userId] = { x, y };
}

export async function listInventory(): Promise<DecorItem[]> {
  await sleep();
  return clone(db.decor.filter((d) => d.ownerId === COUPLE_ID));
}

export async function getDecor(id: string): Promise<DecorItem | null> {
  await sleep(100, 200);
  return clone(db.decor.find((d) => d.id === id) ?? null);
}

export const newInstanceId = () => uid("p");
