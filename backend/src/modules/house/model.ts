import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

export const DECOR_TYPES = ['furniture', 'plant', 'lighting', 'rug', 'wall', 'appliance'] as const;
export const RARITIES = ['common', 'rare', 'epic'] as const;
export const ROTATIONS = [0, 90, 180, 270] as const;
export const HOUSE_ROOM_KINDS = ['living', 'bedroom', 'kitchen'] as const;

const ADDRESS = /^0x[a-f0-9]{40}$/;
const TOKEN_ID = /^\d+$/;

/** Catalog of decor NFTs (static metadata, mirrored from the contract). */
const decorItemSchema = new Schema(
  {
    contract: { type: String, required: true, lowercase: true, match: ADDRESS },
    tokenId: { type: String, required: true, match: TOKEN_ID },
    name: { type: String, required: true, maxlength: 80 },
    image: { type: String, default: null, maxlength: 2048 },
    type: { type: String, enum: DECOR_TYPES, required: true },
    /** Footprint in tiles at rotation 0. */
    size: {
      w: { type: Number, required: true, min: 1, max: 8 },
      h: { type: Number, required: true, min: 1, max: 8 },
    },
    rarity: { type: String, enum: RARITIES, required: true },
    // --- frontend fields ---
    /** Pixel sprite key (frontend/lib/pixel/sprites.ts). */
    sprite: { type: String, required: true, maxlength: 40 },
    description: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
decorItemSchema.index({ contract: 1, tokenId: 1 }, { unique: true });
decorItemSchema.index({ type: 1, rarity: 1 });

export type DecorItem = InferSchemaType<typeof decorItemSchema>;
export const DecorItemModel = model('DecorItem', decorItemSchema, 'decorItems');

const houseRoomSchema = new Schema(
  {
    key: { type: String, required: true, maxlength: 40 },
    kind: { type: String, enum: HOUSE_ROOM_KINDS, required: true },
    name: { type: String, required: true, maxlength: 40 },
    x: { type: Number, required: true, min: 0 },
    y: { type: Number, required: true, min: 0 },
    w: { type: Number, required: true, min: 1 },
    h: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const placedItemSchema = new Schema(
  {
    /** Client-generated id for this placement. */
    instanceId: { type: String, required: true, maxlength: 64 },
    contract: { type: String, required: true, lowercase: true, match: ADDRESS },
    tokenId: { type: String, required: true, match: TOKEN_ID },
    x: { type: Number, required: true, min: 0 },
    y: { type: Number, required: true, min: 0 },
    rotation: { type: Number, enum: ROTATIONS, default: 0 },
    /** HouseRoom.key the item sits in. */
    room: { type: String, default: null, maxlength: 40 },
  },
  { _id: false },
);

const houseSchema = new Schema(
  {
    coupleId: { type: Schema.Types.ObjectId, ref: 'Couple', required: true, unique: true },
    // --- frontend fields: grid size + room layout ---
    cols: { type: Number, default: 24, min: 4, max: 64 },
    rows: { type: Number, default: 14, min: 4, max: 64 },
    rooms: { type: [houseRoomSchema], default: [] },
    items: { type: [placedItemSchema], default: [] },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
// Partner positions inside the house are live state: kept in PresenceStore, not here.

export type House = InferSchemaType<typeof houseSchema>;
export const HouseModel = model('House', houseSchema, 'houses');
