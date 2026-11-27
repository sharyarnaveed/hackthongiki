import type { Channel, Message } from "@/lib/types";
import { db } from "../db";
import { CURRENT_USER_ID } from "../data/users";
import { COUPLE_CHANNEL_ID } from "../data/chat";
import { clone, iso, sleep, uid } from "../delay";

export { COUPLE_CHANNEL_ID };

export async function listChannels(workspaceId: string | null): Promise<Channel[]> {
  await sleep(150, 300);
  return clone(db.channels.filter((c) => c.workspaceId === workspaceId));
}

export async function listMessages(channelId: string): Promise<Message[]> {
  await sleep();
  return clone(db.messages.filter((m) => m.channelId === channelId));
}

export async function sendMessage(channelId: string, body: string): Promise<Message> {
  await sleep(120, 300);
  const msg: Message = { id: uid("m"), channelId, authorId: CURRENT_USER_ID, body, createdAt: iso() };
  db.messages.push(msg);
  return clone(msg);
}

export async function createChannel(workspaceId: string, name: string): Promise<Channel> {
  await sleep();
  const c: Channel = { id: uid("c"), workspaceId, name: name.toLowerCase().replace(/\s+/g, "-"), unread: 0 };
  db.channels.push(c);
  return clone(c);
}

export async function markRead(channelId: string): Promise<void> {
  await sleep(50, 100);
  const c = db.channels.find((x) => x.id === channelId);
  if (c) c.unread = 0;
}
