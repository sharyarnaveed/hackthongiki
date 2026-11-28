import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The WorkspaceOwnership contract (contracts/WorkspaceOwnership.sol) as the backend sees it.
 * `viemChain()` talks to a real chain; tests plug in an in-memory one with the same rules.
 */
export interface OwnershipChain {
  /** The app wallet: the contract owner, which mints, holds tokens in custody and syncs transfers. */
  readonly app: Address;
  readonly contract: Address;
  readonly chainId: number;
  /** Block explorer base URL (e.g. Snowtrace), or null if unknown. */
  readonly explorer: string | null;

  exists(tokenId: bigint): Promise<boolean>;
  ownerOf(tokenId: bigint): Promise<Address>;
  /** The contract's owner, to check the configured key really controls it. */
  contractOwner(): Promise<Address>;
  // Each write waits until it's mined and throws if it reverted.
  mint(tokenId: bigint): Promise<Hex>;
  setAllowed(tokenId: bigint, wallets: Address[], allowed: boolean): Promise<Hex>;
  syncTransfer(tokenId: bigint, to: Address): Promise<Hex>;
  burn(tokenId: bigint): Promise<Hex>;

  latestBlock(): Promise<bigint>;
  /** Token transfers mined in [fromBlock, toBlock], with who sent the transaction. */
  transfers(fromBlock: bigint, toBlock: bigint): Promise<Transfer[]>;
}

export type Transfer = { from: Address; to: Address; tokenId: bigint; txHash: Hex; txSender: Address; blockNumber: bigint };

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Token id = the workspace's MongoDB id read as a number. */
export const tokenIdOf = (workspaceId: string) => BigInt(`0x${workspaceId}`);
/** The workspace id a token id stands for (24 hex digits), or null if it can't be one. */
export function workspaceIdOf(tokenId: bigint) {
  const hex = tokenId.toString(16);
  return hex.length <= 24 ? hex.padStart(24, "0") : null;
}

const ABI = parseAbi([
  "function mint(uint256 tokenId)",
  "function setAllowed(uint256 tokenId, address[] wallets, bool allowed)",
  "function syncTransfer(uint256 tokenId, address to)",
  "function burn(uint256 tokenId)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  // Errors, so a revert reads "RecipientNotMember" in the logs instead of raw bytes.
  "error RecipientNotMember(uint256 tokenId, address to)",
  "error OwnableUnauthorizedAccount(address account)",
  "error ERC721InvalidSender(address sender)",
  "error ERC721InvalidReceiver(address receiver)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
]);

/** Known explorers by chain id, used when CHAIN_EXPLORER isn't set. */
const EXPLORERS: Record<number, string> = {
  43113: "https://testnet.snowtrace.io",
  43114: "https://snowtrace.io",
};

export type ChainConfig = { rpcUrl: string; chainId: number; contract: Address; privateKey: Hex; explorer: string | null };

/**
 * Read the chain settings from the environment.
 * Returns null (on-chain ownership off) when none are set, or a list of problems when they're incomplete or invalid.
 */
export function chainConfigFromEnv(env = process.env): ChainConfig | null | { problems: string[] } {
  const rpcUrl = env.CHAIN_RPC_URL?.trim();
  const chainId = env.CHAIN_ID?.trim();
  const contract = env.OWNERSHIP_CONTRACT?.trim();
  const privateKey = env.CHAIN_PRIVATE_KEY?.trim();
  // Contract and key are what turn it on; the RPC and chain id alone are just defaults.
  if (!contract && !privateKey) return null;
  const problems: string[] = [];
  if (!rpcUrl) problems.push("CHAIN_RPC_URL is empty");
  if (!chainId || !/^\d+$/.test(chainId)) problems.push("CHAIN_ID must be a number (43113 for Fuji)");
  if (!contract || !isAddress(contract)) problems.push("OWNERSHIP_CONTRACT must be the deployed contract address (0x + 40 hex digits)");
  const key = privateKey && !privateKey.startsWith("0x") ? `0x${privateKey}` : privateKey;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) problems.push("CHAIN_PRIVATE_KEY must be 64 hex digits (with or without 0x)");
  if (problems.length) return { problems };
  const id = Number(chainId);
  return {
    rpcUrl: rpcUrl!,
    chainId: id,
    contract: getAddress(contract!),
    privateKey: key as Hex,
    explorer: env.CHAIN_EXPLORER?.trim().replace(/\/+$/, "") || EXPLORERS[id] || null,
  };
}

/** The real contract over JSON-RPC (viem). */
export function viemChain(cfg: ChainConfig): OwnershipChain {
  const chain = defineChain({
    id: cfg.chainId,
    name: `chain ${cfg.chainId}`,
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const account = privateKeyToAccount(cfg.privateKey);
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl, { retryCount: 2 }) });
  const wallet = createWalletClient({ chain, account, transport: http(cfg.rpcUrl, { retryCount: 2 }) });
  const address = cfg.contract;

  async function write(functionName: "mint" | "setAllowed" | "syncTransfer" | "burn", args: readonly unknown[]): Promise<Hex> {
    // Simulating first turns a revert into a readable error (e.g. RecipientNotMember) before any gas is spent.
    const { request } = await pub.simulateContract({ address, abi: ABI, functionName, args, account } as never);
    const hash = await wallet.writeContract(request as never);
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (tx ${hash})`);
    return hash;
  }

  const senders = new Map<Hex, Address>();
  async function senderOf(hash: Hex) {
    let from = senders.get(hash);
    if (!from) {
      from = (await pub.getTransaction({ hash })).from;
      if (senders.size > 500) senders.clear();
      senders.set(hash, from);
    }
    return from;
  }

  return {
    app: account.address,
    contract: address,
    chainId: cfg.chainId,
    explorer: cfg.explorer,
    exists: (tokenId) => pub.readContract({ address, abi: ABI, functionName: "exists", args: [tokenId] }),
    ownerOf: (tokenId) => pub.readContract({ address, abi: ABI, functionName: "ownerOf", args: [tokenId] }),
    contractOwner: () => pub.readContract({ address, abi: ABI, functionName: "owner" }),
    mint: (tokenId) => write("mint", [tokenId]),
    setAllowed: (tokenId, wallets, allowed) => write("setAllowed", [tokenId, wallets, allowed]),
    syncTransfer: (tokenId, to) => write("syncTransfer", [tokenId, to]),
    burn: (tokenId) => write("burn", [tokenId]),
    // No cache: right after a transaction we must see the block it was mined in.
    latestBlock: () => pub.getBlockNumber({ cacheTime: 0 }),
    async transfers(fromBlock, toBlock) {
      const logs = await pub.getContractEvents({ address, abi: ABI, eventName: "Transfer", fromBlock, toBlock });
      const out: Transfer[] = [];
      for (const log of logs) {
        const { from, to, tokenId } = log.args;
        if (!from || !to || tokenId === undefined || !log.transactionHash || log.blockNumber === null) continue;
        out.push({ from, to, tokenId, txHash: log.transactionHash, txSender: getAddress(await senderOf(log.transactionHash)), blockNumber: log.blockNumber });
      }
      return out;
    },
  };
}
