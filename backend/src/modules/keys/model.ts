import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

/**
 * Passphrase-wrapped private key backup. The client derives a key from the
 * user's passphrase (using `salt`) and encrypts the private key locally;
 * the server only ever stores the opaque result.
 */
const keyBackupSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    encryptedPrivateKey: { type: String, required: true, maxlength: 16_384 },
    salt: { type: String, required: true, maxlength: 256 },
    iv: { type: String, default: null, maxlength: 64 },
    /** KDF description chosen by the client, e.g. { name: "PBKDF2", iterations: 600000 }. */
    kdf: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export type KeyBackup = InferSchemaType<typeof keyBackupSchema>;
export const KeyBackupModel = model('KeyBackup', keyBackupSchema, 'keyBackups');
