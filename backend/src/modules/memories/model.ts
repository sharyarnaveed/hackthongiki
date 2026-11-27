import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

/**
 * A shared couple memory. Title, note and emoji are private, so the client
 * packs them into one encrypted payload (`noteCiphertext`). Only non-sensitive
 * display hints (gradient placeholder, date) are stored in the clear.
 */
const memorySchema = new Schema(
  {
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fileId: { type: Schema.Types.ObjectId, default: null },
    noteCiphertext: { type: String, required: true, maxlength: 64_000 },
    iv: { type: String, required: true, maxlength: 64 },
    // --- frontend fields ---
    /** The day the memory happened (distinct from createdAt). */
    date: { type: Date, default: () => new Date() },
    /** Placeholder card background (CSS gradient) when there is no photo. */
    gradient: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
memorySchema.index({ coupleId: 1, date: -1 });

export type Memory = InferSchemaType<typeof memorySchema>;
export const MemoryModel = model('Memory', memorySchema, 'memories');
