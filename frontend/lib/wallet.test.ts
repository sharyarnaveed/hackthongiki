import { hexToString, verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { WalletError, shortAddress, signInMessage } from "./wallet";

vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), apiGet: vi.fn() }));

const account = privateKeyToAccount(generatePrivateKey());

/** A pretend MetaMask on Base Sepolia that signs with a real key. */
function fakeWallet(overrides: Record<string, (params?: unknown[]) => unknown> = {}) {
  const handlers: Record<string, (params?: unknown[]) => unknown> = {
    eth_requestAccounts: () => [account.address.toLowerCase()],
    eth_chainId: () => "0x14a34",
    personal_sign: (params) => account.signMessage({ message: hexToString((params as [`0x${string}`])[0]) }),
    ...overrides,
  };
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => handlers[method](params));
  window.ethereum = { request };
  return request;
}

beforeEach(() => vi.mocked(api.apiGet).mockResolvedValue({ nonce: "abc123def456" }));
afterEach(() => {
  delete window.ethereum;
});

describe("signInMessage (EIP-4361)", () => {
  it("builds a SIWE message for this site and signs it with the wallet", async () => {
    fakeWallet();
    const { message, signature, address } = await signInMessage("signin");

    expect(api.apiGet).toHaveBeenCalledWith("/api/auth/wallet/nonce");
    expect(address).toBe(account.address);
    const fields = parseSiweMessage(message);
    expect(fields).toMatchObject({
      address: account.address,
      domain: window.location.host,
      uri: window.location.origin,
      nonce: "abc123def456",
      chainId: 84532,
      version: "1",
      statement: "Sign in to TheSpace.",
    });
    expect(await verifyMessage({ address: account.address, message, signature: signature as `0x${string}` })).toBe(true);
  });

  it("uses a different statement when linking", async () => {
    fakeWallet();
    const { message } = await signInMessage("link");
    expect(parseSiweMessage(message).statement).toBe("Link this wallet to your TheSpace account.");
  });

  it("explains when there's no wallet installed", async () => {
    await expect(signInMessage("signin")).rejects.toThrow(/No wallet found/);
    expect(api.apiGet).not.toHaveBeenCalled();
  });

  it("explains when the user rejects the request", async () => {
    fakeWallet({ personal_sign: () => Promise.reject({ code: 4001, message: "User rejected" }) });
    const err = await signInMessage("signin").catch((e) => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err.message).toBe("You cancelled the request in your wallet.");
  });

  it("shortens addresses", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
