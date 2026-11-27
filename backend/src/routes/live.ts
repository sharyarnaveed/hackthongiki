import type { FastifyPluginAsync } from "fastify";
import { Types } from "mongoose";
import { CLOSE, type ChatMessage, type LiveStatus } from "@/components/office/live/protocol";
import { live } from "../live/hub.ts";
import { rateLimiter } from "../lib/onboarding.ts";
import { originAllowed } from "../lib/origin.ts";
import { NOT_FOUND, memberWorkspace, mid, type Ws } from "../lib/workspace.ts";
import { MESSAGE_MAX, MessageModel } from "../models/Message.ts";
import { WorkspaceModel } from "../models/Workspace.ts";

/** Whole-office channel; every room of the saved office has its own channel too. */
export const OFFICE_CHANNEL = "office";
const PAGE = 50;

// 10 messages per 10 seconds per member is plenty for typing; more is a stuck key or a script.
const chatLimit = rateLimiter(10, 10_000);

/** "office" plus each room's name, in the office's order, without repeats. */
export function channelsOf(ws: Ws): string[] {
  const rooms = (ws.office as { rooms?: { name: string }[] } | null)?.rooms ?? [];
  return [OFFICE_CHANNEL, ...new Set(rooms.map((r) => r.name).filter((n) => typeof n === "string" && n !== OFFICE_CHANNEL))];
}

type MessageDoc = InstanceType<typeof MessageModel>;
const messageView = (m: MessageDoc): ChatMessage => ({
  messageId: m.id as string,
  channel: m.channel,
  text: m.text,
  authorId: String(m.authorId),
  authorName: m.authorName,
  authorAvatar: m.authorAvatar,
  createdAt: (m.get("createdAt") as Date).toISOString(),
});

/**
 * Real-time office: the live WebSocket (presence, movement, proximity chat,
 * relayed voice and video) and the workspace chat stored in `messages`.
 * Registered inside `workspaceRoutes`, so every route here is signed-in.
 */
export const liveRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The live connection (presence, movement, proximity chat, relayed voice and video). The session cookie is checked by `requireAuth` before
   * the upgrade; the Origin is checked here because CORS doesn't cover sockets.
   */
  app.get<{ Params: { id: string } }>("/:id/live", { websocket: true }, async (socket, req) => {
    if (!originAllowed(req.headers.origin, req.headers["x-forwarded-host"] ?? req.headers.host)) {
      req.log.warn({ origin: req.headers.origin }, "⛔ Live: socket refused — unknown origin");
      return socket.close(CLOSE.origin, "Unknown origin");
    }
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return socket.close(CLOSE.denied, "Not a member of this workspace");
    const { ws, me } = found;
    const spawn = (ws.office as { spawn?: { tx: number; ty: number } } | null)?.spawn;
    const pos = me.position && typeof me.position.x === "number" && typeof me.position.y === "number" ? { x: me.position.x, y: me.position.y as number } : null;
    const start = pos ?? (spawn ? { x: spawn.tx * 16, y: spawn.ty * 16 + 8 } : { x: 0, y: 0 });
    const memberId = mid(me);
    live.join(
      ws.id,
      ws.office as never,
      { id: memberId, name: me.displayName, avatarId: me.avatarId, status: (me.status ?? "available") as LiveStatus, ...start },
      socket,
      () => {
        WorkspaceModel.updateOne({ _id: ws._id, "members._id": me._id }, { $set: { "members.$.lastSeenAt": new Date() } }).catch((err) =>
          req.log.error({ err: (err as Error).message }, "❌ Live: couldn't save last seen"),
        );
      },
    );
  });

  /** Recent chat in one channel (newest last). `before` pages back through older messages. */
  app.get<{ Params: { id: string }; Querystring: { channel?: string; before?: string } }>(
    "/:id/messages",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { channel: { type: "string", maxLength: 40 }, before: { type: "string", maxLength: 40 } },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws } = found;
      const channels = channelsOf(ws);
      const channel = req.query.channel ?? OFFICE_CHANNEL;
      if (!channels.includes(channel)) return reply.code(404).send({ message: "That room isn't in this office." });
      const filter: Record<string, unknown> = { workspaceId: ws._id, channel };
      if (req.query.before) {
        const before = new Date(req.query.before);
        if (Number.isNaN(+before)) return reply.code(400).send({ message: "`before` must be a date." });
        filter.createdAt = { $lt: before };
      }
      const page = await MessageModel.find(filter).sort({ createdAt: -1 }).limit(PAGE + 1);
      const more = page.length > PAGE;
      const messages = page.slice(0, PAGE).reverse().map(messageView);
      return reply.send({ channel, channels, messages, more, online: [...live.online(ws.id)] });
    },
  );

  /** Post to the office or a room's channel; everyone in the office sees it right away. */
  app.post<{ Params: { id: string }; Body: { channel: string; text: string } }>(
    "/:id/messages",
    {
      schema: {
        body: {
          type: "object",
          required: ["channel", "text"],
          additionalProperties: false,
          properties: { channel: { type: "string", minLength: 1, maxLength: 40 }, text: { type: "string", minLength: 1, maxLength: MESSAGE_MAX } },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (!channelsOf(ws).includes(req.body.channel)) return reply.code(404).send({ message: "That room isn't in this office." });
      const text = req.body.text.trim();
      if (!text) return reply.code(400).send({ message: "Write something first.", errors: { text: "Write something first." } });
      if (!chatLimit(mid(me))) {
        req.log.warn({ id: ws.id, member: me.displayName }, "⏳ Chat message rejected: too fast");
        return reply.code(429).send({ message: "You're sending messages very fast. Wait a moment." });
      }
      const msg = await MessageModel.create({
        workspaceId: ws._id,
        channel: req.body.channel,
        text,
        authorId: me._id,
        authorName: me.displayName,
        authorAvatar: me.avatarId,
      });
      const message = messageView(msg);
      live.broadcast(ws.id, { t: "chat", message });
      req.log.info({ id: ws.id, member: me.displayName, channel: message.channel, chars: text.length }, "💬 Chat message saved to MongoDB");
      return reply.code(201).send({ message });
    },
  );
};

/** Delete a workspace's chat (when the workspace is deleted). */
export const deleteMessages = (workspaceId: Types.ObjectId) => MessageModel.deleteMany({ workspaceId });
