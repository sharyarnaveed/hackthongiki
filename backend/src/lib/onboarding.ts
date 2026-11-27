import { randomInt } from "node:crypto";

/** Allowed option ids — mirrors frontend/components/onboarding/model.ts, avatars.ts and office/features.ts. */
export const PURPOSES = ["remote-team", "startup", "freelance", "study-group", "personal", "exploring"];
export const TEAM_SIZES = ["solo", "2-5", "6-15", "16-50", "50+"];
export const STYLES = ["cozy-green", "creative-studio", "quiet-minimal", "community-lounge"];
export const LAYOUTS = ["classic", "open-plan", "loft", "home", "study-house", "garden-cafe"];
export const FEATURES = [
  "desks", "meeting", "kitchen", "tables", "seating", "bed", "fireplace", "bookshelves",
  "plants", "rugs", "lamps", "art", "stringLights", "music", "office", "cat",
];
export const AVATARS = [
  "buddy-maya", "buddy-theo", "buddy-juno", "buddy-sam", "buddy-ines", "buddy-rio",
  "buddy-pip", "buddy-kai", "buddy-ada", "buddy-omar", "buddy-lu", "buddy-gus",
];

export const LIMITS = { displayName: 32, workspaceName: 40, workspaceDescription: 140, invitations: 25 } as const;

/** 8 chars from an unambiguous alphabet (no 0/O, 1/I/L), generated with a CSPRNG. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function newInviteCode() {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** "k7qf-mp3x" → "K7QFMP3X". */
export const normalizeCode = (raw: string) => raw.replace(/[\s\-–—_.]/g, "").toUpperCase();
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Tiny in-memory fixed-window limiter, keyed by e.g. IP. Good enough for a single process. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    h.n++;
    return h.n <= max;
  };
}
