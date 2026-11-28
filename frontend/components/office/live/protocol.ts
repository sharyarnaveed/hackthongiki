/**
 * The live office wire format, shared by the browser and the API (the backend
 * imports this file through the `@/` alias). One WebSocket per open office:
 * `GET /api/workspaces/:id/live`. Every frame is one JSON object with a `t` type.
 */

export type LiveStatus = "available" | "focusing" | "break";

/** How an avatar is drawn right now: feet position, sheet frame or animation, mirroring and depth. */
export interface Pose {
  x: number;
  y: number;
  frame: number;
  /** "walk-down", "walk-up", "walk-side" or "sit-type"; null shows `frame` still. */
  anim: AvatarAnim | null;
  flip: boolean;
  depth: number;
}

export const AVATAR_ANIMS = ["walk-down", "walk-up", "walk-side", "sit-type"] as const;
export type AvatarAnim = (typeof AVATAR_ANIMS)[number];

/** A teammate in the office, as everyone else sees them. `id` is their member id. */
export interface PeerView extends Pose {
  id: string;
  name: string;
  avatarId: string;
  status: LiveStatus;
  /** The room they're standing in ("" between rooms). */
  room: string;
  /** Proximity voice switched on. */
  voice: boolean;
  /** The room whose video call they joined, or null. */
  call: string | null;
}

/** A workspace chat message (stored in the `messages` collection). */
export interface ChatMessage {
  messageId: string;
  /** "office" for everyone, or a room name. */
  channel: string;
  text: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  createdAt: string;
}

export type ClientMsg =
  | ({ t: "move"; room: string } & Pose)
  /** Say something out loud: only people standing nearby hear it. */
  | { t: "say"; text: string }
  | { t: "voice"; on: boolean }
  /** Join a room's video call (null leaves it). */
  | { t: "call"; room: string | null }
  /** WebRTC offer/answer/ICE for a direct link, passed on to `to`. */
  | { t: "signal"; to: string; link: string; data: SignalData }
  /** Teammates we're connected to directly: the API stops relaying our media to them. */
  | { t: "direct"; ids: string[] };

export type SignalData =
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { kind: "bye" };

export type ServerMsg =
  | { t: "welcome"; you: string; peers: PeerView[]; callRooms: string[] }
  | { t: "join"; peer: PeerView }
  | { t: "leave"; id: string }
  | ({ t: "move"; id: string; room: string } & Pose)
  | { t: "peer"; id: string; patch: Partial<Pick<PeerView, "name" | "avatarId" | "status" | "voice" | "call">> }
  | { t: "say"; id: string; text: string }
  | { t: "chat"; message: ChatMessage }
  | { t: "signal"; from: string; link: string; data: SignalData }
  /** The owner rebuilt the office or moved furniture: load it again. */
  | { t: "office-changed"; by: string }
  | { t: "error"; message: string };

/** Close codes the server uses; the client doesn't reconnect after these. */
export const CLOSE = {
  /** The same member opened the office in another tab. */
  replaced: 4409,
  /** Removed from the workspace, left it, or it was deleted. */
  gone: 4410,
  /** Not a member / not signed in. */
  denied: 4404,
  /** The page's origin isn't our frontend. */
  origin: 4403,
} as const;

/** People within this many world pixels (feet to feet) hear what you say. */
export const SAY_RADIUS = 6 * 16;
export const SAY_MAX = 140;
/** Longest workspace chat message. */
export const MESSAGE_MAX = 500;
/** Proximity voice connects inside this distance and hangs up beyond the drop distance. */
export const VOICE_RADIUS = 5 * 16;
export const VOICE_DROP = 7 * 16;
/** Most people in one room's video call (everyone connects to everyone). */
export const CALL_MAX = 8;

/** Rooms that host video calls: meeting rooms and call/phone booths. */
export const isCallRoom = (name: string) => /meeting|call|phone/i.test(name);

/*
 * Voice and video: browsers first try a direct WebRTC connection (lowest
 * latency). Pairs that can't connect directly (strict firewalls) fall back to
 * binary frames on this socket, relayed by the API — so no TURN server is needed.
 *
 *   browser → API:  [kind] [payload]
 *   API → browser:  [kind] [sender's member id, 24 ASCII chars] [payload]
 *
 * Audio: 16 kHz mono, G.711 µ-law (1 byte per sample), 20 ms per frame.
 * Video: one JPEG (320×180) per frame, a few frames a second.
 */
export const MEDIA = { audio: 1, video: 2 } as const;
export const MEDIA_ID_LEN = 24;
export const AUDIO_RATE = 16000;
export const AUDIO_FRAME = 320;
/** Largest frames the API relays. */
export const MAX_AUDIO_BYTES = 2048;
export const MAX_VIDEO_BYTES = 48 * 1024;

/** Direct link ids: one WebRTC connection per pair and purpose, named so both sides agree. */
export const proxLink = (a: string, b: string) => `prox:${[a, b].sort().join(":")}`;
export const callLink = (room: string, a: string, b: string) => `call:${[a, b].sort().join(":")}:${room}`;
/** The side with the smaller id sends the offer, so two offers never cross. */
export const isCaller = (me: string, other: string) => me < other;
