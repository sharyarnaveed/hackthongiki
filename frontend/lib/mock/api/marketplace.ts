import type { DecorItem, DecorType, Listing, Rarity } from "@/lib/types";
import { db } from "../db";
import { COUPLE_ID } from "../data/couple";
import { CURRENT_USER_ID } from "../data/users";
import { clone, iso, sleep, uid } from "../delay";

export interface ListingFilters {
  type?: DecorType | "all";
  rarity?: Rarity | "all";
  minPrice?: number;
  maxPrice?: number;
  query?: string;
}
export type ListingWithItem = Listing & { item: DecorItem };

export async function listListings(f: ListingFilters = {}): Promise<ListingWithItem[]> {
  await sleep();
  const rows = db.listings
    .map((l) => ({ ...l, item: db.decor.find((d) => d.id === l.itemId)! }))
    .filter(({ item, priceUsdc }) =>
      (!f.type || f.type === "all" || item.type === f.type) &&
      (!f.rarity || f.rarity === "all" || item.rarity === f.rarity) &&
      (f.minPrice == null || priceUsdc >= f.minPrice) &&
      (f.maxPrice == null || priceUsdc <= f.maxPrice) &&
      (!f.query || item.name.toLowerCase().includes(f.query.toLowerCase())),
    );
  return clone(rows);
}

/**
 * Buying creates a pending wallet transaction that the partner must approve.
 * Nothing is transferred until both partners approve (see wallet.approve).
 */
export async function buy(listingId: string): Promise<{ txId: string }> {
  await sleep(500, 900);
  const l = db.listings.find((x) => x.id === listingId);
  if (!l) throw new Error("Listing no longer available");
  if (l.sellerId === COUPLE_ID) throw new Error("You can't buy your own listing");
  const item = db.decor.find((d) => d.id === l.itemId)!;
  const txId = uid("t");
  db.wallet.transactions.unshift({
    id: txId, kind: "purchase", label: `Buy ${item.name}`, amountUsdc: -l.priceUsdc,
    createdAt: iso(), createdBy: CURRENT_USER_ID, status: "pending", approvals: [CURRENT_USER_ID],
  });
  return { txId };
}

export async function listForSale(itemId: string, priceUsdc: number): Promise<Listing> {
  await sleep(400, 700);
  if (!(priceUsdc > 0)) throw new Error("Price must be greater than 0");
  const item = db.decor.find((d) => d.id === itemId && d.ownerId === COUPLE_ID);
  if (!item) throw new Error("You don't own this item");
  item.forSale = true;
  item.priceUsdc = priceUsdc;
  const existing = db.listings.find((l) => l.itemId === itemId);
  if (existing) {
    existing.priceUsdc = priceUsdc;
    return clone(existing);
  }
  const l: Listing = { id: uid("l"), itemId, sellerId: COUPLE_ID, sellerName: "You & Sam", priceUsdc, listedAt: iso() };
  db.listings.unshift(l);
  return clone(l);
}

export async function unlist(itemId: string): Promise<void> {
  await sleep();
  const item = db.decor.find((d) => d.id === itemId);
  if (item) { item.forSale = false; item.priceUsdc = undefined; }
  db.listings = db.listings.filter((l) => l.itemId !== itemId);
}
