import { getAddress, toHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { BRAND } from "@/components/landing/brand";
import { apiGet } from "./api";

/** A browser wallet (MetaMask, Coinbase Wallet, Rabby…), per EIP-1193. */
type Eip1193Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export class WalletError extends Error {}

export const hasWallet = () => typeof window !== "undefined" && !!window.ethereum;

/** "0x1234…abcd" */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Turn a wallet's error into something we can show. Code 4001 = the user said no. */
function walletError(err: unknown): WalletError {
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) return new WalletError("You cancelled the request in your wallet.");
  if (e?.code === -32002) return new WalletError("Your wallet already has a request open. Check the wallet window.");
  return new WalletError(e?.message || "The wallet didn't respond. Try again.");
}

/**
 * Sign-In with Ethereum (EIP-4361): connect the wallet, get a one-time nonce from
 * the API, and have the wallet sign a message for this exact site. The API checks
 * the signature and the nonce; nothing is sent on-chain and it costs no gas.
 */
export async function signInMessage(purpose: "signin" | "link"): Promise<{ message: string; signature: string; address: string }> {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!eth) throw new WalletError("No wallet found in this browser. Install MetaMask (or another Ethereum wallet) and try again.");

  let address: `0x${string}`;
  let chainId: number;
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new WalletError("Your wallet didn't share an account.");
    address = getAddress(accounts[0]);
    chainId = Number.parseInt((await eth.request({ method: "eth_chainId" })) as string, 16) || 1;
  } catch (err) {
    throw err instanceof WalletError ? err : walletError(err);
  }

  const { nonce } = await apiGet<{ nonce: string }>("/api/auth/wallet/nonce");
  const message = createSiweMessage({
    address,
    chainId,
    domain: window.location.host,
    uri: window.location.origin,
    scheme: window.location.protocol.slice(0, -1),
    nonce,
    version: "1",
    issuedAt: new Date(),
    statement: purpose === "link" ? `Link this wallet to your ${BRAND.name} account.` : `Sign in to ${BRAND.name}.`,
  });

  try {
    const signature = (await eth.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
    return { message, signature, address };
  } catch (err) {
    throw walletError(err);
  }
}
