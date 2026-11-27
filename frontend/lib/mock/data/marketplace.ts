import type { Listing } from "@/lib/types";
import { iso } from "../delay";

/** 5 items are listed: 2 by the couple, 3 by other players. */
export const listings: Listing[] = [
  { id: "l1", itemId: "d8", sellerId: "cp1", sellerName: "You & Sam", priceUsdc: 18, listedAt: iso(1) },
  { id: "l2", itemId: "d10", sellerId: "cp1", sellerName: "You & Sam", priceUsdc: 75, listedAt: iso(3) },
  { id: "l3", itemId: "d11", sellerId: "seller_kai", sellerName: "Kai & Remy", priceUsdc: 120, listedAt: iso(0, 5) },
  { id: "l4", itemId: "d12", sellerId: "seller_ivy", sellerName: "Ivy & June", priceUsdc: 6, listedAt: iso(2) },
  { id: "l5", itemId: "d13", sellerId: "seller_ivy", sellerName: "Ivy & June", priceUsdc: 32, listedAt: iso(6) },
];
