import { model, Schema, type InferSchemaType } from 'mongoose';
import { toJSONOptions } from '../../lib/mongoose.js';

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true, default: 'member' },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
    // --- frontend fields ---
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9-]{2,40}$/ },
    /** Emoji or short glyph shown in the sidebar. */
    icon: { type: String, default: null, maxlength: 8 },
    color: { type: String, default: '#2563eb', match: /^#[0-9a-fA-F]{6}$/ },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
workspaceSchema.index({ 'members.userId': 1 });

export type Workspace = InferSchemaType<typeof workspaceSchema>;
export const WorkspaceModel = model('Workspace', workspaceSchema, 'workspaces');

const workspaceInviteSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    /** Optional: restrict the invite to one email address. */
    email: { type: String, default: null, lowercase: true, trim: true },
    maxUses: { type: Number, default: null, min: 1 },
    uses: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
workspaceInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type WorkspaceInvite = InferSchemaType<typeof workspaceInviteSchema>;
export const WorkspaceInviteModel = model('WorkspaceInvite', workspaceInviteSchema, 'workspaceInvites');
