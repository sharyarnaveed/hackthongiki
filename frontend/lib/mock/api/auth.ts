import type { User } from "@/lib/types";
import { db } from "../db";
import { CURRENT_USER_ID } from "../data/users";
import { clone, sleep, uid } from "../delay";

export async function login(email: string, password: string): Promise<User> {
  await sleep(400, 800);
  if (!password) throw new Error("Enter your password");
  if (!email.includes("@")) throw new Error("Enter a valid email");
  return clone(db.users.find((u) => u.id === CURRENT_USER_ID)!);
}

export async function signup(name: string, email: string, password: string): Promise<User> {
  await sleep(500, 900);
  if (password.length < 6) throw new Error("Password must be at least 6 characters");
  if (!email.includes("@")) throw new Error("Enter a valid email");
  const me = db.users.find((u) => u.id === CURRENT_USER_ID)!;
  return clone({ ...me, id: uid("u"), name, email });
}

export async function getCurrentUser(): Promise<User> {
  await sleep(100, 200);
  return clone(db.users.find((u) => u.id === CURRENT_USER_ID)!);
}

export async function updateProfile(patch: Partial<Pick<User, "name" | "title" | "statusText" | "status">>): Promise<User> {
  await sleep();
  const me = db.users.find((u) => u.id === CURRENT_USER_ID)!;
  Object.assign(me, patch);
  return clone(me);
}

export async function listUsers(ids?: string[]): Promise<User[]> {
  await sleep(100, 250);
  return clone(ids ? db.users.filter((u) => ids.includes(u.id)) : db.users);
}
