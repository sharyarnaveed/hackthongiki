import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

/** workspace = channel-wide chat, room = office room chat, couple = home chat. */
export const MESSAGE_SCOPES = ['workspace', 'room', 'couple'] as const;
export type MessageScope = (typeof MESSAGE_SCOPES)[number];

const messageSchema = new Schema(
  {
    scopeType: { type: String, enum: MESSAGE_SCOPES, required: true },
    scopeId: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Client-side encrypted message body (the server never sees plaintext). */
    ciphertext: { type: String, required: true, maxlength: 64_000 },
    iv: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
// Cursor pagination: newest first within a scope, _id as tiebreaker.
messageSchema.index({ scopeId: 1, createdAt: -1, _id: -1 });

export type Message = InferSchemaType<typeof messageSchema>;
export const MessageModel = model('Message', messageSchema, 'messages');
