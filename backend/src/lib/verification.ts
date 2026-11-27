import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
export const MAX_ATTEMPTS = 5;

export const newCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");
export const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

export function codeMatches(code: string, storedHash: string) {
  const a = Buffer.from(hashCode(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
