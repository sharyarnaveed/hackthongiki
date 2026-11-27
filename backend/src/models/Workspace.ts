import { Schema, Types, model, type InferSchemaType } from "mongoose";
import { DEFAULT_STATUS, STATUSES } from "../lib/status.ts";

const memberSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 32 },
    avatarId: { type: String, required: true },
    // owner: everything · admin: manages invitations and members · member: just works here.
    role: { type: String, enum: ["owner", "admin", "member"], default: "member" },
    joinedAt: { type: Date, default: () => new Date() },
    // The desk this member sits at (the office map's 0-based desk index); null if every desk is taken.
    desk: { type: Number, default: null },
    status: { type: String, enum: STATUSES, default: DEFAULT_STATUS },
    statusUpdatedAt: { type: Date },
    // Last time this member opened the office.
    lastSeenAt: { type: Date },
    // Where the avatar was standing when the member last left (world pixels, feet), for the office saved at `officeSavedAt`.
    position: {
      type: new Schema({ x: Number, y: Number, savedAt: Date }, { _id: false }),
      default: null,
    },
  },
  { _id: true },
);

const invitationSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    sentAt: { type: Date },
    invitedAt: { type: Date, default: () => new Date() },
    // How many times the email has been sent (first send + resends).
    sendCount: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * A member asking another member to swap desks. Both desks are recorded as they
 * were when asked: if either person has moved since, the request is stale.
 */
const deskRequestSchema = new Schema(
  {
    from: { type: Types.ObjectId, required: true }, // member _id asking
    to: { type: Types.ObjectId, required: true }, // member _id whose desk they want
    fromDesk: { type: Number, required: true },
    toDesk: { type: Number, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
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
    deskRequests: { type: [deskRequestSchema], default: [] },
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
