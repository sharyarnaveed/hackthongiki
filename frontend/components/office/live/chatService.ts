import { apiGet, apiPost } from "@/lib/api";
import type { ChatMessage } from "./protocol";

const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

/** The whole-office channel; each room of the office has its own channel named after it. */
export const OFFICE_CHANNEL = "office";

export type MessagesResponse = { channel: string; channels: string[]; messages: ChatMessage[]; more: boolean; online: string[] };

/** Recent messages in a channel, oldest first. `before` (ISO date) pages back. */
export const getMessages = (id: string, channel: string, before?: string) =>
  apiGet<MessagesResponse>(`${ws(id)}/messages?channel=${encodeURIComponent(channel)}${before ? `&before=${encodeURIComponent(before)}` : ""}`);

export const sendMessage = (id: string, channel: string, text: string) => apiPost<{ message: ChatMessage }>(`${ws(id)}/messages`, { channel, text });
