import { getAddress, type Address } from "viem";
import type { DecorChain } from "../src/lib/decorChain.ts";

/** An in-memory OfficeDecor contract with the same rules as contracts/OfficeDecor.sol. Every call is a "block". */
export class FakeDecor implements DecorChain {
  readonly chainId = 43113;
  readonly explorer = "https://testnet.snowtrace.io";
  readonly contract: Address;
  private items: { name: string; kind: string; price: bigint; forSale: boolean }[] = [];
  private owners = new Map<bigint, Address>();
  private itemOf = new Map<bigint, bigint>();
  private listings = new Map<bigint, { seller: Address; price: bigint }>();
  private next = 1n;
  private block = 500n;
  private events: { block: bigint; item?: bigint; token?: bigint }[] = [];

  constructor(contract: Address) {
    this.contract = getAddress(contract);
  }
  private emit(e: { item?: bigint; token?: bigint }) {
    this.events.push({ block: ++this.block, ...e });
  }

  // Reads (DecorChain)
  async itemCount() {
    return BigInt(this.items.length);
  }
  async item(itemId: bigint) {
    const it = this.items[Number(itemId)];
    if (!it) throw new Error(`UnknownItem(${itemId})`);
    return { ...it };
  }
  async nextTokenId() {
    return this.next;
  }
  async token(tokenId: bigint) {
    const holder = this.owners.get(tokenId);
    if (!holder) return null;
    return { holder, itemId: this.itemOf.get(tokenId)!, listing: this.listings.get(tokenId) ?? null };
  }
  async latestBlock() {
    return this.block;
  }
  async changes(from: bigint, to: bigint) {
    const hit = this.events.filter((e) => e.block >= from && e.block <= to);
    const items = new Set(hit.flatMap((e) => (e.item === undefined ? [] : [e.item])));
    const tokens = new Set(hit.flatMap((e) => (e.token === undefined ? [] : [e.token])));
    return { items: [...items], tokens: [...tokens] };
  }

  // Writes, as the app or a user's wallet would send them
  addItem(name: string, kind: string, price: bigint) {
    this.items.push({ name, kind, price, forSale: true });
    this.emit({ item: BigInt(this.items.length - 1) });
  }
  buy(buyer: Address, itemId: bigint, value: bigint) {
    const it = this.items[Number(itemId)];
    if (!it) throw new Error("UnknownItem");
    if (!it.forSale) throw new Error("NotForSale");
    if (value !== it.price) throw new Error("WrongPayment");
    const tokenId = this.next++;
    this.owners.set(tokenId, getAddress(buyer));
    this.itemOf.set(tokenId, itemId);
    this.emit({ token: tokenId });
    return tokenId;
  }
  list(seller: Address, tokenId: bigint, price: bigint) {
    if (this.owners.get(tokenId) !== getAddress(seller)) throw new Error("NotYourToken");
    if (price === 0n) throw new Error("ZeroPrice");
    this.listings.set(tokenId, { seller: getAddress(seller), price });
    this.owners.set(tokenId, this.contract);
    this.emit({ token: tokenId });
  }
  cancel(seller: Address, tokenId: bigint) {
    const l = this.listings.get(tokenId);
    if (!l) throw new Error("NotListed");
    if (l.seller !== getAddress(seller)) throw new Error("NotYourToken");
    this.listings.delete(tokenId);
    this.owners.set(tokenId, l.seller);
    this.emit({ token: tokenId });
  }
  buyListing(buyer: Address, tokenId: bigint, value: bigint) {
    const l = this.listings.get(tokenId);
    if (!l) throw new Error("NotListed");
    if (value !== l.price) throw new Error("WrongPayment");
    this.listings.delete(tokenId);
    this.owners.set(tokenId, getAddress(buyer));
    this.emit({ token: tokenId });
  }
}
