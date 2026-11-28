import { getAddress, type Address, type Hex } from "viem";
import { ZERO, type OwnershipChain, type Transfer } from "../src/lib/chain.ts";

/**
 * An in-memory WorkspaceOwnership contract with the same rules as
 * contracts/WorkspaceOwnership.sol, so the sync can be tested without a chain.
 * Every write is its own "block".
 */
export class FakeChain implements OwnershipChain {
  readonly chainId = 43113;
  readonly explorer = "https://testnet.snowtrace.io";
  readonly contract: Address;
  private owners = new Map<bigint, Address>();
  private allowed = new Map<bigint, Set<string>>();
  private log: Transfer[] = [];
  private block = 100n;
  private txCount = 0;
  /** Writes the app wallet sent, by function name. */
  readonly writes: string[] = [];

  constructor(readonly app: Address, contract: Address) {
    this.contract = getAddress(contract);
  }

  private tx(): Hex {
    this.block++;
    return `0x${(++this.txCount).toString(16).padStart(64, "0")}`;
  }
  private move(tokenId: bigint, from: Address, to: Address, sender: Address) {
    // The contract's _update rule: holders may only send to approved members (or back to the app).
    const isTransfer = from !== ZERO && to !== ZERO;
    if (isTransfer && sender !== this.app && to !== this.app && !this.isAllowed(tokenId, to)) throw new Error(`RecipientNotMember(${tokenId}, ${to})`);
    const txHash = this.tx();
    if (to === ZERO) this.owners.delete(tokenId);
    else this.owners.set(tokenId, to);
    this.log.push({ from, to, tokenId, txHash, txSender: sender, blockNumber: this.block });
    return txHash;
  }
  private owned(tokenId: bigint) {
    const holder = this.owners.get(tokenId);
    if (!holder) throw new Error(`ERC721NonexistentToken(${tokenId})`);
    return holder;
  }

  isAllowed = (tokenId: bigint, wallet: Address) => this.allowed.get(tokenId)?.has(wallet.toLowerCase()) ?? false;

  async exists(tokenId: bigint) {
    return this.owners.has(tokenId);
  }
  async ownerOf(tokenId: bigint) {
    return this.owned(tokenId);
  }
  async contractOwner() {
    return this.app;
  }
  async mint(tokenId: bigint) {
    this.writes.push("mint");
    if (this.owners.has(tokenId)) throw new Error("ERC721InvalidSender(0x0)");
    return this.move(tokenId, ZERO, this.app, this.app);
  }
  async setAllowed(tokenId: bigint, wallets: Address[], allowed: boolean) {
    this.writes.push("setAllowed");
    const set = this.allowed.get(tokenId) ?? new Set();
    for (const w of wallets) allowed ? set.add(w.toLowerCase()) : set.delete(w.toLowerCase());
    this.allowed.set(tokenId, set);
    return this.tx();
  }
  async syncTransfer(tokenId: bigint, to: Address) {
    this.writes.push("syncTransfer");
    return this.move(tokenId, this.owned(tokenId), getAddress(to), this.app);
  }
  async burn(tokenId: bigint) {
    this.writes.push("burn");
    return this.move(tokenId, this.owned(tokenId), ZERO, this.app);
  }
  async latestBlock() {
    return this.block;
  }
  async transfers(fromBlock: bigint, toBlock: bigint) {
    return this.log.filter((t) => t.blockNumber >= fromBlock && t.blockNumber <= toBlock);
  }

  /** A holder calling transferFrom from their own wallet (not the app). */
  holderSends(holder: Address, to: Address, tokenId: bigint) {
    if (this.owned(tokenId) !== getAddress(holder)) throw new Error("ERC721IncorrectOwner");
    return this.move(tokenId, getAddress(holder), getAddress(to), getAddress(holder));
  }
}
