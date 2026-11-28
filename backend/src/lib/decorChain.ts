import { createPublicClient, defineChain, getAddress, http, isAddress, parseAbi, type Address } from "viem";

/**
 * The OfficeDecor contract (contracts/OfficeDecor.sol), read-only, as the backend sees it.
 * People buy, list and sell from their own wallet in the browser; the backend only reads.
 * Tests plug in an in-memory version with the same rules.
 */
export interface DecorChain {
  readonly contract: Address;
  readonly chainId: number;
  readonly explorer: string | null;

  itemCount(): Promise<bigint>;
  item(itemId: bigint): Promise<{ name: string; kind: string; price: bigint; forSale: boolean }>;
  /** Next token id the shop will mint (ids start at 1). */
  nextTokenId(): Promise<bigint>;
  /** A token's state, or null if it doesn't exist (never minted). */
  token(tokenId: bigint): Promise<{ holder: Address; itemId: bigint; listing: { seller: Address; price: bigint } | null } | null>;
  latestBlock(): Promise<bigint>;
  /** Catalog items and tokens that events in [fromBlock, toBlock] touched. */
  changes(fromBlock: bigint, toBlock: bigint): Promise<{ items: bigint[]; tokens: bigint[] }>;
}

/** The contract's ABI: what the backend reads, and what the browser sends. */
export const DECOR_ABI = parseAbi([
  "function itemCount() view returns (uint256)",
  "function item(uint256 itemId) view returns (string name, string kind, uint256 price, bool forSale)",
  "function itemOf(uint256 tokenId) view returns (uint256)",
  "function listings(uint256 tokenId) view returns (address seller, uint256 price)",
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function owner() view returns (address)",
  "function addItem(string name, string kind, uint256 price) returns (uint256)",
  "function updateItem(uint256 itemId, uint256 price, bool forSale)",
  "function buy(uint256 itemId) payable returns (uint256)",
  "function list(uint256 tokenId, uint256 price)",
  "function cancel(uint256 tokenId)",
  "function buyListing(uint256 tokenId) payable",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event ItemAdded(uint256 indexed itemId, string name, string kind, uint256 price)",
  "event ItemUpdated(uint256 indexed itemId, uint256 price, bool forSale)",
  "event Bought(uint256 indexed tokenId, uint256 indexed itemId, address indexed buyer, uint256 price)",
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event Unlisted(uint256 indexed tokenId, address indexed seller)",
  "event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)",
  // Errors, so a failed transaction says why ("WrongPayment") instead of raw bytes.
  "error UnknownItem(uint256 itemId)",
  "error NotForSale(uint256 itemId)",
  "error WrongPayment(uint256 expected, uint256 sent)",
  "error NotYourToken(uint256 tokenId)",
  "error NotListed(uint256 tokenId)",
  "error ZeroPrice()",
  "error PaymentFailed()",
  "error OwnableUnauthorizedAccount(address account)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
]);

const EXPLORERS: Record<number, string> = { 43113: "https://testnet.snowtrace.io", 43114: "https://snowtrace.io" };

export type DecorConfig = { rpcUrl: string; chainId: number; contract: Address; explorer: string | null };

/** DECOR_CONTRACT (+ CHAIN_RPC_URL, CHAIN_ID) turn the market on. Null = off; problems = set but invalid. */
export function decorConfigFromEnv(env = process.env): DecorConfig | null | { problems: string[] } {
  const contract = env.DECOR_CONTRACT?.trim();
  if (!contract) return null;
  const rpcUrl = env.CHAIN_RPC_URL?.trim();
  const chainId = env.CHAIN_ID?.trim();
  const problems: string[] = [];
  if (!isAddress(contract)) problems.push("DECOR_CONTRACT must be the deployed OfficeDecor address (0x + 40 hex digits)");
  if (!rpcUrl) problems.push("CHAIN_RPC_URL is empty");
  if (!chainId || !/^\d+$/.test(chainId)) problems.push("CHAIN_ID must be a number (43113 for Fuji)");
  if (problems.length) return { problems };
  const id = Number(chainId);
  return { rpcUrl: rpcUrl!, chainId: id, contract: getAddress(contract), explorer: env.CHAIN_EXPLORER?.trim().replace(/\/+$/, "") || EXPLORERS[id] || null };
}

export function viemDecorChain(cfg: DecorConfig): DecorChain {
  const chain = defineChain({
    id: cfg.chainId,
    name: `chain ${cfg.chainId}`,
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl, { retryCount: 2 }) });
  const address = cfg.contract;
  const read = <T>(functionName: string, args: readonly unknown[] = []) => pub.readContract({ address, abi: DECOR_ABI, functionName, args } as never) as Promise<T>;

  return {
    contract: address,
    chainId: cfg.chainId,
    explorer: cfg.explorer,
    itemCount: () => read<bigint>("itemCount"),
    async item(itemId) {
      const [name, kind, price, forSale] = await read<[string, string, bigint, boolean]>("item", [itemId]);
      return { name, kind, price, forSale };
    },
    nextTokenId: () => read<bigint>("nextTokenId"),
    async token(tokenId) {
      let holder: Address;
      try {
        holder = await read<Address>("ownerOf", [tokenId]);
      } catch {
        return null; // ERC721NonexistentToken
      }
      const [itemId, [seller, price]] = await Promise.all([read<bigint>("itemOf", [tokenId]), read<[Address, bigint]>("listings", [tokenId])]);
      return { holder, itemId, listing: price > 0n ? { seller, price } : null };
    },
    // No cache: right after a transaction we must see the block it was mined in.
    latestBlock: () => pub.getBlockNumber({ cacheTime: 0 }),
    async changes(fromBlock, toBlock) {
      const logs = await pub.getContractEvents({ address, abi: DECOR_ABI, fromBlock, toBlock });
      const items = new Set<bigint>();
      const tokens = new Set<bigint>();
      for (const log of logs) {
        const args = log.args as { itemId?: bigint; tokenId?: bigint };
        if (log.eventName === "ItemAdded" || log.eventName === "ItemUpdated") {
          if (args.itemId !== undefined) items.add(args.itemId);
        } else if (args.tokenId !== undefined) tokens.add(args.tokenId);
      }
      return { items: [...items], tokens: [...tokens] };
    },
  };
}
