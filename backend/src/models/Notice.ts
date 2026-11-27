import { Schema, Types, model } from "mongoose";

/** Colours a note can have on the board (match the frontend's palette tokens). */
export const NOTE_COLORS = ["sun", "sage", "terracotta", "paper"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** One note pinned to a workspace's notice board. Only the owner writes them; every member reads them. */
const noticeSchema = new Schema(
  {
    workspaceId: { type: Types.ObjectId, ref: "Workspace", required: true },
    text: { type: String, required: true, trim: true, maxlength: 280 },
    color: { type: String, enum: NOTE_COLORS, default: "sun" },
    // Pinned notes stay at the top of the board.
    pinned: { type: Boolean, default: false },
    // The member who wrote it, and their name tag at the time.
    authorId: { type: Types.ObjectId, required: true },
    authorName: { type: String, required: true, maxlength: 32 },
  },
  { timestamps: true, collection: "notices" },
);
noticeSchema.index({ workspaceId: 1, pinned: -1, createdAt: -1 });

export const NoticeModel = model("Notice", noticeSchema);
