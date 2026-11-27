import type { Channel, Message } from "@/lib/types";
import { iso } from "../delay";

export const COUPLE_CHANNEL_ID = "c-couple";

export const channels: Channel[] = [
  { id: "c1", workspaceId: "w1", name: "general", topic: "Company-wide chatter", unread: 2 },
  { id: "c2", workspaceId: "w1", name: "design", topic: "Pixels, flows and feedback", unread: 0 },
  { id: "c3", workspaceId: "w2", name: "general", topic: "Side project HQ", unread: 0 },
  { id: COUPLE_CHANNEL_ID, workspaceId: null, name: "us", unread: 1 },
];

const m = (id: string, channelId: string, authorId: string, body: string, minsAgo: number, reactions?: Message["reactions"]): Message => ({
  id, channelId, authorId, body, createdAt: iso(0, 0, minsAgo), reactions,
});

export const messages: Message[] = [
  m("m1", "c1", "u2", "Morning all! Sprint review is at 11 in the Boardroom.", 180),
  m("m2", "c1", "u5", "The staging deploy is green again 🎉", 170, [{ emoji: "🎉", userIds: ["u1", "u3", "u8"] }]),
  m("m3", "c1", "u8", "Reminder: launch post goes live Thursday.", 150),
  m("m4", "c1", "u1", "I'll share the new office floor mocks after lunch.", 140),
  m("m5", "c1", "u4", "Heads up, I'm out from 12–2.", 120),
  m("m6", "c1", "u3", "Anyone up for a quick pairing session on the video grid?", 95),
  m("m7", "c1", "u6", "Found two regressions in the call controls, filing now.", 80),
  m("m8", "c1", "u7", "CI runners are being upgraded tonight, expect a short outage.", 60),
  m("m9", "c1", "u2", "Thanks Omar. Please post the window in #ops too.", 45),
  m("m10", "c1", "u5", "Coffee in the Main Hall in 10 ☕", 12, [{ emoji: "☕", userIds: ["u1", "u8"] }]),

  m("m11", "c2", "u1", "Uploaded v3 of the meeting room layout.", 300),
  m("m12", "c2", "u3", "Love the compact tiles. Can we try 4px less padding?", 290),
  m("m13", "c2", "u1", "Sure, pushing an update.", 285),
  m("m14", "c2", "u4", "Can the leave button be more obvious?", 260),
  m("m15", "c2", "u1", "Making it red and separated from the rest.", 255),
  m("m16", "c2", "u8", "For marketing shots, can we get a dark mode version?", 200),
  m("m17", "c2", "u1", "Dark mode is in! Toggle in the title bar.", 190, [{ emoji: "🌙", userIds: ["u8", "u3"] }]),
  m("m18", "c2", "u3", "The avatars on the floor map are so cute.", 100),
  m("m19", "c2", "u2", "Ship it 🚢", 90),
  m("m20", "c2", "u1", "🚢🚢🚢", 88),

  m("m21", COUPLE_CHANNEL_ID, "u9", "Movie night tonight? 🍿", 240),
  m("m22", COUPLE_CHANNEL_ID, "u1", "Yes! Your pick this time.", 235),
  m("m23", COUPLE_CHANNEL_ID, "u9", "I moved the plant next to the sofa, check it out", 120),
  m("m24", COUPLE_CHANNEL_ID, "u1", "Looks so cozy 🌿", 118),
  m("m25", COUPLE_CHANNEL_ID, "u9", "Also approved the lamp purchase in the wallet", 30),
];
