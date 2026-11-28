import type { FastifyPluginAsync } from "fastify";
import { Types } from "mongoose";
import { catalog } from "@/components/office/game/furniture";
import { applyMoves, blocksTheWay, groupOf, kindLabel, placementProblem, type FurnitureMeta, type FurnitureMove, type LayoutFloor } from "@/components/office/game/layoutEdit";
import type { OfficeMap } from "@/components/office/game/map";
import { live } from "../live/hub.ts";
import { STAT_ACTIONS, statsView, takeTurn, type StatAction } from "../lib/stats.ts";
import { NOT_FOUND, memberWorkspace, mid } from "../lib/workspace.ts";
import { NOTE_COLORS, NoticeModel, type NoteColor } from "../models/Notice.ts";
import { WorkspaceModel } from "../models/Workspace.ts";

/** A board holds this many notes; the owner tidies up before adding more. */
export const MAX_NOTICES = 30;
const NOTE_TEXT = { type: "string", minLength: 1, maxLength: 280 };
const ONLY_OWNER = { message: "Only the workspace owner can change the notice board." };
const NOTE_GONE = { message: "That note isn't on the board any more." };

type NoticeDoc = InstanceType<typeof NoticeModel>;
const noticeView = (n: NoticeDoc) => ({
  noticeId: n.id as string,
  text: n.text,
  color: n.color,
  pinned: n.pinned,
  authorName: n.authorName,
  createdAt: n.get("createdAt") as Date,
  updatedAt: n.get("updatedAt") as Date,
});

/** Pinned notes first, then newest. */
const boardOf = async (workspaceId: unknown) =>
  (await NoticeModel.find({ workspaceId }).sort({ pinned: -1, createdAt: -1 }).limit(MAX_NOTICES)).map(noticeView);

/** Footprints and layers of every furniture kind in this office's style (rugs and the sign are flat). */
export function furnitureMeta(office: OfficeMap): FurnitureMeta {
  const meta: FurnitureMeta = { rug: { footprint: null, layer: "floor" }, sign: { footprint: null, layer: "wall" } };
  for (const [kind, def] of Object.entries(catalog(office.theme))) meta[kind] = { footprint: def.footprint, layer: def.layer };
  return meta;
}

const spot = { type: "object", required: ["tx", "ty"], additionalProperties: false, properties: { tx: { type: "integer" }, ty: { type: "integer" } } };

/**
 * Office life: the notice board, small stats (coffees, cat pets, focus time)
 * and moving furniture. Registered inside `workspaceRoutes`, so every route here is signed-in.
 */
export const officeLifeRoutes: FastifyPluginAsync = async (app) => {
  /* ---------------------------- Notice board ---------------------------- */

  /** Everything on the board, and whether you may change it. */
  app.get<{ Params: { id: string } }>("/:id/notices", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    return reply.send({ notices: await boardOf(found.ws._id), canEdit: found.me.role === "owner", max: MAX_NOTICES });
  });

  /** Owner: pin a new note to the board. */
  app.post<{ Params: { id: string }; Body: { text: string; color?: NoteColor; pinned?: boolean } }>(
    "/:id/notices",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: NOTE_TEXT, color: { type: "string", enum: [...NOTE_COLORS] }, pinned: { type: "boolean" } },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") {
        req.log.warn({ id: ws.id, user: req.user!.email, role: me.role }, "⛔ Notice rejected: not the owner");
        return reply.code(403).send(ONLY_OWNER);
      }
      const text = req.body.text.trim();
      if (!text) return reply.code(400).send({ message: "Write something on the note first.", errors: { text: "Write something on the note first." } });
      if ((await NoticeModel.countDocuments({ workspaceId: ws._id })) >= MAX_NOTICES) {
        return reply.code(409).send({ message: `The board is full (${MAX_NOTICES} notes). Take one down first.` });
      }
      const note = await NoticeModel.create({
        workspaceId: ws._id,
        text,
        color: req.body.color ?? "sun",
        pinned: req.body.pinned ?? false,
        authorId: me._id,
        authorName: me.displayName,
      });
      req.log.info({ id: ws.id, by: me.displayName, notice: note.id, chars: text.length, pinned: note.pinned }, "📌 Notice added — saved to MongoDB");
      return reply.code(201).send({ notice: noticeView(note), notices: await boardOf(ws._id) });
    },
  );

  /** Owner: edit a note's text or colour, or pin/unpin it. */
  app.patch<{ Params: { id: string; noticeId: string }; Body: { text?: string; color?: NoteColor; pinned?: boolean } }>(
    "/:id/notices/:noticeId",
    {
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: { text: NOTE_TEXT, color: { type: "string", enum: [...NOTE_COLORS] }, pinned: { type: "boolean" } },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") return reply.code(403).send(ONLY_OWNER);
      if (!Types.ObjectId.isValid(req.params.noticeId)) return reply.code(404).send(NOTE_GONE);
      const set: Record<string, unknown> = {};
      if (req.body.text !== undefined) {
        const text = req.body.text.trim();
        if (!text) return reply.code(400).send({ message: "A note can't be empty. Take it down instead.", errors: { text: "A note can't be empty." } });
        set.text = text;
      }
      if (req.body.color !== undefined) set.color = req.body.color;
      if (req.body.pinned !== undefined) set.pinned = req.body.pinned;
      const note = await NoticeModel.findOneAndUpdate({ _id: req.params.noticeId, workspaceId: ws._id }, { $set: set }, { returnDocument: "after" });
      if (!note) return reply.code(404).send(NOTE_GONE);
      req.log.info({ id: ws.id, by: me.displayName, notice: note.id, changed: Object.keys(set) }, "📝 Notice edited — saved to MongoDB");
      return reply.send({ notice: noticeView(note), notices: await boardOf(ws._id) });
    },
  );

  /** Owner: take a note down. */
  app.delete<{ Params: { id: string; noticeId: string } }>("/:id/notices/:noticeId", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    if (me.role !== "owner") return reply.code(403).send(ONLY_OWNER);
    if (!Types.ObjectId.isValid(req.params.noticeId)) return reply.code(404).send(NOTE_GONE);
    const res = await NoticeModel.deleteOne({ _id: req.params.noticeId, workspaceId: ws._id });
    if (!res.deletedCount) return reply.code(404).send(NOTE_GONE);
    req.log.info({ id: ws.id, by: me.displayName, notice: req.params.noticeId }, "🗑️  Notice taken down");
    return reply.send({ deleted: true, notices: await boardOf(ws._id) });
  });

  /* -------------------------------- Stats ------------------------------- */

  /** Office totals, your own numbers and everyone's (focus time includes a session still running). */
  app.get<{ Params: { id: string } }>("/:id/stats", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    return reply.send(statsView(found.ws, found.me));
  });

  /** Count something you just did in the office: made a coffee or petted the cat. */
  app.post<{ Params: { id: string }; Body: { action: StatAction } }>(
    "/:id/me/stats",
    {
      schema: {
        body: { type: "object", required: ["action"], additionalProperties: false, properties: { action: { type: "string", enum: Object.keys(STAT_ACTIONS) } } },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      const field = STAT_ACTIONS[req.body.action];
      // Mashing E counts once: repeats within a few seconds are ignored, not errors.
      if (!takeTurn(mid(me), req.body.action)) {
        return reply.send({ counted: false, ...statsView(ws, me) });
      }
      const updated = await WorkspaceModel.findOneAndUpdate(
        { _id: ws._id, "members._id": me._id },
        { $inc: { [`members.$.stats.${field}`]: 1, [`stats.${field}`]: 1 } },
        { returnDocument: "after" },
      );
      if (!updated) return reply.code(404).send(NOT_FOUND);
      const view = statsView(updated, updated.members.find((m) => mid(m) === mid(me))!);
      req.log.info({ id: ws.id, member: me.displayName, action: req.body.action, yours: view.you[field], office: view.office[field] }, "📊 Office stat counted");
      return reply.send({ counted: true, ...view });
    },
  );

  /* --------------------------- Moving furniture -------------------------- */

  /**
   * Owner: save furniture moved in arrange mode. Every move says where the piece
   * was, so a tab showing an older layout can't scramble the office; the new
   * spots are checked with the same rules the office uses while you drag.
   */
  app.put<{ Params: { id: string }; Body: { officeSavedAt?: string; moves: FurnitureMove[] } }>(
    "/:id/office/layout",
    {
      schema: {
        body: {
          type: "object",
          required: ["moves"],
          additionalProperties: false,
          properties: {
            officeSavedAt: { type: "string", maxLength: 40 },
            moves: {
              type: "array",
              minItems: 1,
              maxItems: 300,
              items: {
                type: "object",
                required: ["index", "kind", "from", "to"],
                additionalProperties: false,
                properties: { index: { type: "integer", minimum: 0 }, kind: { type: "string", maxLength: 40 }, from: spot, to: spot },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") {
        req.log.warn({ id: ws.id, user: req.user!.email, role: me.role }, "⛔ Furniture move rejected: not the owner");
        return reply.code(403).send({ message: "Only the workspace owner can move furniture." });
      }
      const office = ws.office as OfficeMap | null;
      const stale = { message: "The office changed since you started arranging. Reload it and try again." };
      if (!office || !Array.isArray(office.objects)) return reply.code(409).send(stale);
      const { officeSavedAt, moves } = req.body;
      if (officeSavedAt && ws.officeSavedAt && +new Date(officeSavedAt) !== +ws.officeSavedAt) {
        req.log.info({ id: ws.id }, "ℹ️  Furniture move ignored: sent for an older version of the office");
        return reply.code(409).send(stale);
      }

      const meta = furnitureMeta(office);
      const objects = applyMoves(office.objects, moves, meta);
      if (!objects) {
        req.log.warn({ id: ws.id, moves: moves.length }, "⚠️  Furniture move rejected: doesn't match the saved layout");
        return reply.code(409).send(stale);
      }
      const before: LayoutFloor = office;
      const next: LayoutFloor = { ...office, objects };
      for (const m of moves) {
        const problem = placementProblem(next, groupOf(objects, m.index), meta);
        if (problem) {
          req.log.warn({ id: ws.id, kind: m.kind, to: m.to, problem }, "❌ Furniture move rejected");
          return reply.code(400).send({ message: `The ${kindLabel(m.kind)} can't go there: ${problem}` });
        }
      }
      const blocked = blocksTheWay(before, next, meta);
      if (blocked) return reply.code(400).send({ message: blocked });

      // Only if nobody (another tab) saved a layout or rebuilt the office meanwhile.
      const version = ws.layoutVersion ?? 0;
      const res = await WorkspaceModel.updateOne(
        { _id: ws._id, officeSavedAt: ws.officeSavedAt, layoutVersion: version === 0 ? { $in: [0, null] } : version },
        { $set: { "office.objects": objects, layoutSavedAt: new Date() }, $inc: { layoutVersion: 1 } },
      );
      if (!res.modifiedCount) {
        req.log.warn({ id: ws.id }, "⚠️  Furniture move lost a race: the layout changed meanwhile");
        return reply.code(409).send(stale);
      }
      req.log.info(
        { id: ws.id, by: me.displayName, moved: moves.map((m) => `${m.kind} ${m.from.tx},${m.from.ty} → ${m.to.tx},${m.to.ty}`), version: version + 1 },
        "🛋️  Furniture moved — layout saved to MongoDB",
      );
      live.officeChanged(ws.id, office as never, { id: mid(me), name: me.displayName });
      return reply.send({ moved: moves.length, layoutVersion: version + 1 });
    },
  );
};
