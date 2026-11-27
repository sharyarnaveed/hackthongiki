import { Schema, Types, model } from "mongoose";
import { MESSAGE_MAX } from "@/components/office/live/protocol";

export { MESSAGE_MAX };

/**
 * One workspace chat message. `channel` is "office" (everyone) or the name of a
 * room in the saved office ("Kitchen", "Meeting room"…), so each room keeps its
 * own conversation. Deleted with the workspace.
 */
const messageSchema = new Schema(
  {
    workspaceId: { type: Types.ObjectId, ref: "Workspace", required: true },
    channel: { type: String, required: true, maxlength: 40 },
    text: { type: String, required: true, trim: true, maxlength: MESSAGE_MAX },
    // The member who wrote it, with their name tag and avatar at the time.
    authorId: { type: Types.ObjectId, required: true },
    authorName: { type: String, required: true, maxlength: 32 },
    authorAvatar: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "messages" },
);
messageSchema.index({ workspaceId: 1, channel: 1, createdAt: -1 });

export const MessageModel = model("Message", messageSchema);
