import { Schema, model } from "mongoose";

/**
 * A one-time Sign-In with Ethereum nonce. Handed out before the wallet signs and
 * deleted the moment a signed message uses it, so a signature can't be replayed.
 */
const walletNonceSchema = new Schema(
  {
    nonce: { type: String, required: true, unique: true },
    // MongoDB drops unused nonces on its own (TTL index).
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { collection: "wallet_nonces" },
);

export const WalletNonceModel = model("WalletNonce", walletNonceSchema);
