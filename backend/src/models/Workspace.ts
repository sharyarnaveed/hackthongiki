import { Schema, Types, model, type InferSchemaType } from "mongoose";
import { DEFAULT_STATUS, STATUSES } from "../lib/status.ts";

const memberSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 32 },
    avatarId: { type: String, required: true },
    role: { type: String, enum: ["owner", "member"], default: "member" },
    joinedAt: { type: Date, default: () => new Date() },
    // The desk this member sits at (the office map's 0-based desk index); null if every desk is taken.
    desk: { type: Number, default: null },
    status: { type: String, enum: STATUSES, default: DEFAULT_STATUS },
    statusUpdatedAt: { type: Date },
    // Last time this member opened the office.
    lastSeenAt: { type: Date },
  },
  { _id: true },
);

const invitationSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    sentAt: { type: Date },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, default: "", trim: true, maxlength: 140 },
    purpose: { type: String, required: true },
    teamSize: { type: String, required: true },
    style: { type: String, required: true },
    layout: { type: String, required: true },
    features: { type: [String], default: [] },
    // Invitation code: one per workspace, can be revoked/expired.
    inviteCode: { type: String, required: true, unique: true },
    inviteCodeExpires: { type: Date },
    inviteCodeRevoked: { type: Boolean, default: false },
    members: { type: [memberSchema], default: [] },
    invitations: { type: [invitationSchema], default: [] },
    // The generated office (tiles, walls, furniture, rooms, spawn, theme) exactly as the
    // client built it, so every visit shows the same placement. Null until first opened.
    office: { type: Schema.Types.Mixed, default: null },
    officeSavedAt: { type: Date },
  },
  { timestamps: true, collection: "workspaces" },
);
workspaceSchema.index({ "members.userId": 1 });

export type Workspace = InferSchemaType<typeof workspaceSchema>;
export const WorkspaceModel = model("Workspace", workspaceSchema);
