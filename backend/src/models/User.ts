import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    dob: { type: Date, required: true },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    // Email verification (only the hash of the 6-digit code is stored).
    verificationCodeHash: { type: String, select: false },
    verificationCodeExpires: { type: Date, select: false },
    verificationSentAt: { type: Date, select: false },
    verificationAttempts: { type: Number, default: 0, select: false },
    // Office settings; they follow the user into every workspace. Defaults mirror DEFAULT_PREFERENCES.
    preferences: {
      sound: { type: Boolean, default: false },
      minimap: { type: Boolean, default: true },
      nameTag: { type: Boolean, default: true },
    },
    lastSignInAt: { type: Date },
  },
  { timestamps: true, collection: "users" },
);

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model("User", userSchema);
