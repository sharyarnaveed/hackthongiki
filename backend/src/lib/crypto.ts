import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Cryptographically random URL-safe token (default 48 bytes ≈ 64 chars). */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short human-friendly invite code, e.g. "K7QX-2MPA". No 0/O/1/I. */
export function inviteCode(groups = 2, groupLen = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(groups * groupLen);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  const out: string[] = [];
  for (let g = 0; g < groups; g++) out.push(chars.slice(g * groupLen, (g + 1) * groupLen).join(''));
  return out.join('-');
}

/** SHA-256 hex digest — used to store refresh tokens without keeping the raw value. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string compare (for signatures). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
