import { createPublicClient, createWalletClient, custom, getAddress, parseAbi, parseEther, toHex, type Address, type Hash } from "viem";
import { apiDelete, apiGet, apiPost } from "./api";
import { WalletError, shortAddress } from "./wallet";

/* ───────────── What the API returns ───────────── */

export type ShopItem = { itemId: number; name: string; kind: string; priceWei: string; price: string; forSale: boolean };
export type Listing = { tokenId: number; itemId: number; name: string; kind: string; seller: string; priceWei: string; price: string; mine: boolean };
export type Market =
  | { enabled: false }
  | { enabled: true; chainId: number; contract: Address; explorer: string | null; items: ShopItem[]; listings: Listing[] };
export type MyDecor = {
  tokenId: number;
  itemId: number;
  name: string;
  kind: string;
  /** Up for sale on the market (the contract holds it meanwhile). */
  listed: { priceWei: string; price: string } | null;
  /** The office it's standing in. */
  placedIn: { workspaceId: string; name: string } | null;
  url: string | null;
};

export const getMarket = () => apiGet<Market>("/api/market");
export const getMyDecor = () => apiGet<{ wallet: string | null; tokens: MyDecor[] }>("/api/market/mine");
/** Ask the server to read new contract events now (after a transaction is mined). */
export const syncMarket = () => apiPost<{ ok: true }>("/api/market/sync", {});
export const placeDecor = (workspaceId: string, tokenId: number) =>
  apiPost<{ tokenId: number; kind: string; tx: number; ty: number }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/decor`, { tokenId });
export const removeDecor = (workspaceId: string, tokenId: number) => apiDelete<{ removed: number }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/decor/${tokenId}`);

/* ───────────── Transactions from the browser wallet ───────────── */

const ABI = parseAbi([
  "function buy(uint256 itemId) payable returns (uint256)",
  "function list(uint256 tokenId, uint256 price)",
  "function cancel(uint256 tokenId)",
  "function buyListing(uint256 tokenId) payable",
  "error UnknownItem(uint256 itemId)",
  "error NotForSale(uint256 itemId)",
  "error WrongPayment(uint256 expected, uint256 sent)",
  "error NotYourToken(uint256 tokenId)",
  "error NotListed(uint256 tokenId)",
  "error ZeroPrice()",
  "error PaymentFailed()",
]);

/** Networks we know how to add to the wallet if it doesn't have them yet. */
const NETWORKS: Record<number, { chainName: string; rpcUrls: string[]; blockExplorerUrls: string[] }> = {
  43113: { chainName: "Avalanche Fuji C-Chain", rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"], blockExplorerUrls: ["https://testnet.snowtrace.io"] },
};

export type DecorAction =
  | { type: "buy"; itemId: number; priceWei: string }
  | { type: "list"; tokenId: number; price: string }
  | { type: "cancel"; tokenId: number }
  | { type: "buyListing"; tokenId: number; priceWei: string };

/** "0.05" → wei, or an error message for a price people can't sell at. */
export function parsePrice(text: string): bigint | string {
  const t = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return "Enter a price in AVAX, like 0.05.";
  const wei = parseEther(t);
  return wei > BigInt(0) ? wei : "The price must be more than 0.";
}

/** Short, human reasons for the contract's errors. */
const REASONS: Record<string, string> = {
  WrongPayment: "The price changed. Refresh and try again.",
  NotForSale: "That item isn't for sale any more.",
  NotListed: "That listing is gone: someone bought it or it was cancelled.",
  NotYourToken: "That decor isn't in this wallet.",
  ZeroPrice: "The price must be more than 0.",
  UnknownItem: "That item doesn't exist.",
};

function txError(err: unknown): WalletError {
  if (err instanceof WalletError) return err;
  const e = err as { code?: number; cause?: { code?: number; data?: { errorName?: string } }; shortMessage?: string; message?: string; walk?: (fn: (e: unknown) => boolean) => unknown };
  if (e?.code === 4001 || e?.cause?.code === 4001 || /user rejected|denied/i.test(e?.message ?? "")) return new WalletError("You cancelled the transaction in your wallet.");
  const named = e?.walk?.((x) => !!(x as { data?: { errorName?: string } })?.data?.errorName) as { data?: { errorName?: string } } | undefined;
  const reason = named?.data?.errorName && REASONS[named.data.errorName];
  if (reason) return new WalletError(reason);
  if (/insufficient funds/i.test(e?.message ?? "")) return new WalletError("Not enough AVAX in this wallet. Get free test AVAX from the Fuji faucet.");
  return new WalletError(e?.shortMessage || e?.message || "The transaction failed. Try again.");
}

/**
 * Send one market transaction from the browser wallet and wait until it's mined:
 * connects the wallet, checks it's the wallet linked to this account, switches to the
 * market's network, sends, waits, then asks the server to pick up the change.
 */
export async function sendDecorTx(market: Extract<Market, { enabled: true }>, linkedWallet: string, action: DecorAction): Promise<Hash> {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!eth) throw new WalletError("No wallet found in this browser. Install MetaMask and try again.");
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new WalletError("Your wallet didn't share an account.");
    const account = getAddress(accounts[0]);
    if (account.toLowerCase() !== linkedWallet.toLowerCase()) {
      throw new WalletError(`Switch MetaMask to your linked wallet ${shortAddress(getAddress(linkedWallet))} (it's on ${shortAddress(account)}).`);
    }

    const chainHex = toHex(market.chainId);
    if (Number.parseInt((await eth.request({ method: "eth_chainId" })) as string, 16) !== market.chainId) {
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (err) {
        const known = NETWORKS[market.chainId];
        // 4902: the wallet doesn't know this network yet.
        if ((err as { code?: number })?.code !== 4902 || !known) throw err;
        await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: chainHex, nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, ...known }] });
      }
    }

    const chain = {
      id: market.chainId,
      name: NETWORKS[market.chainId]?.chainName ?? `Chain ${market.chainId}`,
      nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      rpcUrls: { default: { http: NETWORKS[market.chainId]?.rpcUrls ?? [] } },
    } as const;
    const wallet = createWalletClient({ account, chain, transport: custom(eth) });
    const pub = createPublicClient({ chain, transport: custom(eth) });
    const address = market.contract;

    let hash: Hash;
    if (action.type === "buy") hash = await wallet.writeContract({ address, abi: ABI, functionName: "buy", args: [BigInt(action.itemId)], value: BigInt(action.priceWei) });
    else if (action.type === "buyListing") hash = await wallet.writeContract({ address, abi: ABI, functionName: "buyListing", args: [BigInt(action.tokenId)], value: BigInt(action.priceWei) });
    else if (action.type === "cancel") hash = await wallet.writeContract({ address, abi: ABI, functionName: "cancel", args: [BigInt(action.tokenId)] });
    else {
      const price = parsePrice(action.price);
      if (typeof price === "string") throw new WalletError(price);
      hash = await wallet.writeContract({ address, abi: ABI, functionName: "list", args: [BigInt(action.tokenId), price] });
    }
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new WalletError("The transaction failed on chain. Nothing was charged except gas.");
    await syncMarket().catch(() => {});
    return hash;
  } catch (err) {
    throw txError(err);
  }
}
