import { Schema, model } from "mongoose";

/** The last block whose ownership-token transfers were processed, per contract, so a restart picks up where it left off. */
const chainCursorSchema = new Schema(
  {
    _id: { type: String }, // "<chainId>:<contract address, lowercase>"
    block: { type: Number, required: true },
  },
  { collection: "chain_cursors", timestamps: true },
);

export const ChainCursorModel = model("ChainCursor", chainCursorSchema);
