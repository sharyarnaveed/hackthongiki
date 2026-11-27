import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";

const KEY_LENGTH = 64;

function derive(password: BinaryLike, salt: BinaryLike) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Hash as `salt:key` (both hex) using Node's built-in scrypt. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const key = await derive(password, salt);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
}
