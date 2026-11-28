import { Schema, model } from "mongoose";

/**
 * A copy of the OfficeDecor contract's state, kept up to date from its events (see lib/decor.ts),
 * so the shop and the market load without asking the chain every time. The chain stays the truth.
 * Each collection is tagged with the contract it came from, so a new deployment starts clean.
 */

/** A shop catalog item. Prices are wei, as strings (they don't fit a JS number). */
const decorItemSchema = new Schema(
  {
    contract: { type: String, required: true, lowercase: true },
    itemId: { type: Number, required: true },
    name: { type: String, required: true },
    kind: { type: String, required: true },
    priceWei: { type: String, required: true },
    forSale: { type: Boolean, default: true },
  },
  { collection: "decor_items", timestamps: true },
);
decorItemSchema.index({ contract: 1, itemId: 1 }, { unique: true });

/** A minted decor NFT. While it's listed, the contract holds it and `seller` is who listed it. */
const decorTokenSchema = new Schema(
  {
    contract: { type: String, required: true, lowercase: true },
    tokenId: { type: Number, required: true },
    itemId: { type: Number, required: true },
    // Wallet holding it on chain (the contract itself while listed). Lowercase.
    holder: { type: String, required: true, lowercase: true },
    // Open listing, or null.
    seller: { type: String, lowercase: true, default: null },
    priceWei: { type: String, default: null },
  },
  { collection: "decor_tokens", timestamps: true },
);
decorTokenSchema.index({ contract: 1, tokenId: 1 }, { unique: true });
decorTokenSchema.index({ contract: 1, holder: 1 });
decorTokenSchema.index({ contract: 1, seller: 1 });

export const DecorItemModel = model("DecorItem", decorItemSchema);
export const DecorTokenModel = model("DecorToken", decorTokenSchema);
