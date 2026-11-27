import { Schema, model } from "mongoose";

/** Emails left in the landing page's early-access form. */
const waitlistSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    source: { type: String, default: "landing", maxlength: 40 },
  },
  { timestamps: true, collection: "waitlist" },
);

export const WaitlistModel = model("Waitlist", waitlistSchema);
