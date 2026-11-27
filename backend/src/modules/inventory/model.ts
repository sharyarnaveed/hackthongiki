import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

/** Read-model of NFT balances on Base, kept fresh by the Alchemy webhook. */
const nftOwnershipSchema = new Schema(
  {
    wallet: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
    contract: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
    tokenId: { type: String, required: true, match: /^\d+$/ },
    amount: { type: Number, required: true, min: 0, default: 0 },
    /** Last block applied, so the webhook can ignore out-of-order events. */
    lastBlock: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true }, toJSON: toJSONOptions },
);
// Prefix (wallet, tokenId) serves inventory lookups; the full key keeps one row per holding.
nftOwnershipSchema.index({ wallet: 1, tokenId: 1, contract: 1 }, { unique: true });

export type NftOwnership = InferSchemaType<typeof nftOwnershipSchema>;
export const NftOwnershipModel = model('NftOwnership', nftOwnershipSchema, 'nftOwnership');
