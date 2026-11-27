import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

export const WEBHOOK_SOURCES = ['alchemy', 'crossmint'] as const;

/** Processed webhook ids. Inserting first gives idempotency (duplicate key = already handled). */
const webhookEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, maxlength: 200 },
    source: { type: String, enum: WEBHOOK_SOURCES, required: true },
    processedAt: { type: Date, default: () => new Date() },
  },
  { toJSON: toJSONOptions },
);

export type WebhookEvent = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEventModel = model('WebhookEvent', webhookEventSchema, 'webhookEvents');
