import { getAddress, isHex, verifyMessage, type Address } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { WalletNonceModel } from "../models/WalletNonce.ts";
import { originAllowed } from "./origin.ts";

/** How long the wallet has to sign after asking for a nonce. */
export const NONCE_TTL_MS = 10 * 60 * 1000;

/** A fresh single-use nonce, stored until it's used or expires. */
export async function issueNonce() {
  const nonce = generateSiweNonce();
  await WalletNonceModel.create({ nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return nonce;
}

export type SiweResult = { ok: true; address: Address } | { ok: false; reason: string };

/**
 * Check a signed EIP-4361 message:
 *  - it parses and is a valid SIWE message (version 1, address, not expired / not yet valid),
 *  - it was made for our frontend (domain + URI on an allowed origin, matching the page that sent it),
 *  - the signature really comes from the address in the message,
 *  - its nonce is one we issued and hasn't been used (consumed here, so it works once).
 *
 * Only plain wallets (EOAs) are supported for now; smart-contract wallets (EIP-1271) need a chain RPC.
 */
export async function verifySiwe(message: string, signature: string, origin?: string, host?: string | string[]): Promise<SiweResult> {
  const fields = parseSiweMessage(message);
  if (!fields.address || !fields.domain || !fields.uri || !fields.nonce || !fields.chainId) return { ok: false, reason: "not a Sign-In with Ethereum message" };

  let uri: URL;
  try {
    uri = new URL(fields.uri);
  } catch {
    return { ok: false, reason: "bad URI" };
  }
  if (fields.domain !== uri.host) return { ok: false, reason: "domain doesn't match URI" };
  if (!originAllowed(uri.origin, host)) return { ok: false, reason: `origin ${uri.origin} not allowed` };
  // A browser always sends Origin: the message must be for the very page that's asking.
  if (origin && origin !== uri.origin) return { ok: false, reason: "message was made for another site" };
  if (!validateSiweMessage({ message: fields, domain: uri.host, scheme: uri.protocol.slice(0, -1) })) {
    return { ok: false, reason: "message invalid or expired" };
  }
  if (fields.issuedAt && Math.abs(Date.now() - fields.issuedAt.getTime()) > NONCE_TTL_MS) return { ok: false, reason: "message too old" };

  if (!isHex(signature)) return { ok: false, reason: "bad signature" };
  let valid = false;
  try {
    valid = await verifyMessage({ address: fields.address, message, signature });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature doesn't match address" };

  // Consume the nonce last, so a forged signature can't burn a real user's nonce.
  const used = await WalletNonceModel.findOneAndDelete({ nonce: fields.nonce, expiresAt: { $gt: new Date() } });
  if (!used) return { ok: false, reason: "nonce unknown, used or expired" };

  return { ok: true, address: getAddress(fields.address) };
}
