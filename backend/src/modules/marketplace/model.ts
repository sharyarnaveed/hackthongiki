import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';
import { DECOR_TYPES, RARITIES } from '../house/model.js';

export const LISTING_STATUSES = ['pending', 'active', 'sold', 'cancelled'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/**
 * Off-chain record of an on-chain listing. The contract is the source of truth;
 * this is a searchable index updated by the client (after the tx) and by the webhook.
 */
const listingSchema = new Schema(
  {
    sellerWallet: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
    contract: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
    tokenId: { type: String, required: true, match: /^\d+$/ },
    /** Price in USDC (up to 6 decimals). */
    priceUsdc: { type: Number, required: true, min: 0 },
    status: { type: String, enum: LISTING_STATUSES, default: 'pending' },
    txHash: { type: String, default: null, lowercase: true, match: /^0x[a-f0-9]{64}$/ },
    /** Listing id emitted by the marketplace contract, if any. */
    onchainListingId: { type: String, default: null },
    // --- frontend fields ---
    sellerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sellerName: { type: String, default: null, maxlength: 80 },
    // Denormalised from decorItems so listings can be filtered by type/rarity.
    itemType: { type: String, enum: [...DECOR_TYPES, null], default: null },
    rarity: { type: String, enum: [...RARITIES, null], default: null },
  },
  {
    timestamps: { createdAt: 'listedAt', updatedAt: true },
    toJSON: toJSONOptions,
  },
);
listingSchema.index({ status: 1, tokenId: 1 });
listingSchema.index({ status: 1, itemType: 1, rarity: 1, priceUsdc: 1 });
listingSchema.index({ txHash: 1 }, { unique: true, partialFilterExpression: { txHash: { $type: 'string' } } });

export type Listing = InferSchemaType<typeof listingSchema>;
export const ListingModel = model('Listing', listingSchema, 'listings');
