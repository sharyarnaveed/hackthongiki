import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

const ADDRESS = /^0x[a-f0-9]{40}$/;
const TX_HASH = /^0x[a-f0-9]{64}$/;

/** A user's linked wallet address. We never hold keys or funds. */
const walletSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    address: { type: String, required: true, unique: true, lowercase: true, match: ADDRESS },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export type Wallet = InferSchemaType<typeof walletSchema>;
export const WalletModel = model('Wallet', walletSchema, 'wallets');

/** The couple's 2-of-2 Safe on Base. */
const coupleWalletSchema = new Schema(
  {
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true, unique: true },
    safeAddress: { type: String, required: true, unique: true, lowercase: true, match: ADDRESS },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export type CoupleWallet = InferSchemaType<typeof coupleWalletSchema>;
export const CoupleWalletModel = model('CoupleWallet', coupleWalletSchema, 'coupleWallets');

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'executed'] as const;
export const APPROVAL_KINDS = ['deposit', 'withdraw', 'purchase', 'sale', 'goal'] as const;

/** Off-chain coordination for a Safe transaction both partners must sign. */
const walletApprovalSchema = new Schema(
  {
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
    safeTxHash: { type: String, required: true, unique: true, lowercase: true, match: TX_HASH },
    description: { type: String, required: true, maxlength: 200 },
    /** USDC amount; positive = in, negative = out (matches the frontend Transaction). */
    amount: { type: Number, required: true },
    approvedBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    status: { type: String, enum: APPROVAL_STATUSES, default: 'pending' },
    // --- frontend fields ---
    kind: { type: String, enum: APPROVAL_KINDS, default: 'withdraw' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    executedTxHash: { type: String, default: null, lowercase: true, match: TX_HASH },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
walletApprovalSchema.index({ coupleId: 1, createdAt: -1 });

export type WalletApproval = InferSchemaType<typeof walletApprovalSchema>;
export const WalletApprovalModel = model('WalletApproval', walletApprovalSchema, 'walletApprovals');
