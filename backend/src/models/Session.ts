import { Schema, Types, model } from "mongoose";

/** A signed-in browser. Only the SHA-256 of the cookie token is stored, so a DB leak can't be replayed. */
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    // MongoDB deletes expired sessions on its own (TTL index).
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true, collection: "sessions" },
);

export const SessionModel = model("Session", sessionSchema);
