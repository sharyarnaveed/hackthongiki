import { model, Schema, type InferSchemaType, type Types } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

const coupleSchema = new Schema(
  {
    userA: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userB: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * [userA, userB], filled in automatically. A unique multikey index on this
     * array guarantees a user belongs to at most one couple, whether they are A or B.
     */
    members: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
coupleSchema.index({ members: 1 }, { unique: true });

coupleSchema.pre('validate', function () {
  const a = this.get('userA') as Types.ObjectId | undefined;
  const b = this.get('userB') as Types.ObjectId | undefined;
  if (a && b && a.equals(b)) throw new Error('a couple needs two different users');
  this.set('members', [a, b]);
});

export type Couple = InferSchemaType<typeof coupleSchema>;
export const CoupleModel = model('Couple', coupleSchema, 'couples');

const coupleInviteSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
coupleInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type CoupleInvite = InferSchemaType<typeof coupleInviteSchema>;
export const CoupleInviteModel = model('CoupleInvite', coupleInviteSchema, 'coupleInvites');
