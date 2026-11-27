import { model, Schema, type InferSchemaType } from 'mongoose';
import { withJSONTransform } from '../../lib/mongoose.js';

export const ROOM_TYPES = ['meeting', 'focus', 'lounge', 'open'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

const roomSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ROOM_TYPES, required: true, default: 'open' },
    // --- frontend fields: capacity + placement on the office floor grid ---
    capacity: { type: Number, default: 8, min: 1, max: 500 },
    x: { type: Number, default: 0, min: 0 },
    y: { type: Number, default: 0, min: 0 },
    w: { type: Number, default: 4, min: 1 },
    h: { type: Number, default: 4, min: 1 },
  },
  {
    timestamps: true,
    // Frontend calls this field `kind` (RoomKind in frontend/lib/types.ts).
    toJSON: withJSONTransform((ret) => {
      ret.kind = ret.type;
      delete ret.type;
    }),
  },
);

export type Room = InferSchemaType<typeof roomSchema>;
export const RoomModel = model('Room', roomSchema, 'rooms');
