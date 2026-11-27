import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { toJSONOptions, withJSONTransform } from '../../lib/mongoose.js';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    avatarFileId: { type: Schema.Types.ObjectId, default: null },
    /** Client-generated public key (e.g. base64 SPKI / JWK string) for E2EE. */
    publicKey: { type: String, default: null, maxlength: 4096 },
    // --- frontend profile fields ---
    /** Hex color used for generated avatars. */
    color: { type: String, default: '#2563eb', match: /^#[0-9a-fA-F]{6}$/ },
    title: { type: String, default: null, maxlength: 80 },
    statusText: { type: String, default: null, maxlength: 140 },
  },
  {
    timestamps: true,
    toJSON: withJSONTransform((ret) => {
      delete ret.passwordHash;
    }),
  },
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema, 'users');

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** SHA-256 of the opaque refresh token; the raw token is only ever sent to the client. */
    tokenHash: { type: String, required: true, unique: true },
    /** Token family: all rotations of one login share it, so reuse can revoke the whole family. */
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null, maxlength: 512 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
// TTL: Mongo deletes the doc once expiresAt passes.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema, 'refreshTokens');
