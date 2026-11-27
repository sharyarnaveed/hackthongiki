import type { FastifyPluginAsync } from "fastify";
import { Types } from "mongoose";
import { MAX_OUTGOING, deskRequestsView, involving, liveRequest } from "../lib/deskRequests.ts";
import { NOT_FOUND, memberWorkspace, mid } from "../lib/workspace.ts";
import { WorkspaceModel } from "../models/Workspace.ts";

const label = (d: number) => `desk ${d + 1}`;
const GONE = { message: "That swap request isn't open any more. Someone may have moved desks." };

/**
 * Desk swap requests between members: ask someone for their desk, and they
 * accept (the two desks are swapped) or decline. Any member can use these.
 * Registered inside `workspaceRoutes`, so every route here is signed-in.
 */
export const deskRequestRoutes: FastifyPluginAsync = async (app) => {
  /** Your swap requests: the ones you sent and the ones waiting for you. */
  app.get<{ Params: { id: string } }>("/:id/desk-requests", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    return reply.send({ requests: deskRequestsView(found.ws, found.me) });
  });

  /** Ask another member to swap desks with you. */
  app.post<{ Params: { id: string }; Body: { memberId: string } }>(
    "/:id/desk-requests",
    { schema: { body: { type: "object", required: ["memberId"], additionalProperties: false, properties: { memberId: { type: "string", maxLength: 40 } } } } },
    async (req, reply) => {
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      const target = ws.members.find((m) => mid(m) === req.body.memberId);
      if (!target) return reply.code(404).send({ message: "That person isn't in this workspace any more." });
      if (mid(target) === mid(me)) return reply.code(400).send({ message: "That's already your desk." });
      if (typeof me.desk !== "number") return reply.code(409).send({ message: "You don't have a desk to swap yet." });
      if (typeof target.desk !== "number") return reply.code(409).send({ message: `${target.displayName} doesn't have a desk to swap.` });

      const live = ws.deskRequests.filter((r) => liveRequest(ws, r));
      const same = live.find((r) => String(r.from) === mid(me) && String(r.to) === mid(target));
      if (same) return reply.code(409).send({ message: `You already asked ${target.displayName}. Wait for their answer.` });
      if (live.some((r) => String(r.from) === mid(target) && String(r.to) === mid(me))) {
        return reply.code(409).send({ message: `${target.displayName} already asked to swap with you. Accept their request instead.` });
      }
      if (live.filter((r) => String(r.from) === mid(me)).length >= MAX_OUTGOING) {
        return reply.code(429).send({ message: `You can have ${MAX_OUTGOING} swap requests waiting at once. Cancel one first.` });
      }

      const request = { _id: new Types.ObjectId(), from: me._id, to: target._id, fromDesk: me.desk, toDesk: target.desk, createdAt: new Date() };
      // Only if neither of them moved meanwhile, so the recorded desks are right.
      const res = await WorkspaceModel.updateOne(
        { _id: ws._id, members: { $all: [{ $elemMatch: { _id: me._id, desk: me.desk } }, { $elemMatch: { _id: target._id, desk: target.desk } }] } },
        { $push: { deskRequests: request } },
      );
      if (!res.modifiedCount) {
        req.log.warn({ id: ws.id, by: req.user!.email }, "⚠️  Swap request lost a race: desks changed meanwhile");
        return reply.code(409).send({ message: "Desks just changed. Refresh and try again." });
      }
      req.log.info(
        { id: ws.id, from: `${me.displayName} (${label(me.desk)})`, to: `${target.displayName} (${label(target.desk)})` },
        "🙋 Desk swap requested — saved to MongoDB",
      );
      const updated = (await WorkspaceModel.findById(ws._id))!;
      return reply.code(201).send({ requestId: String(request._id), requests: deskRequestsView(updated, updated.members.find((m) => mid(m) === mid(me))!) });
    },
  );

  /** Accept a request sent to you: the two desks are swapped. */
  app.post<{ Params: { id: string; requestId: string } }>("/:id/desk-requests/:requestId/accept", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    const r = ws.deskRequests.find((x) => String(x._id) === req.params.requestId);
    const live = r && liveRequest(ws, r);
    if (!r || !live) {
      if (r) await WorkspaceModel.updateOne({ _id: ws._id }, { $pull: { deskRequests: { _id: r._id } } });
      return reply.code(404).send(GONE);
    }
    if (mid(live.to) !== mid(me)) {
      req.log.warn({ id: ws.id, user: req.user!.email }, "⛔ Swap accept rejected: not the person asked");
      return reply.code(403).send({ message: "Only the person who was asked can accept." });
    }
    const { from, to } = live;
    // Swap only if both are still at the desks from the request; then drop every request
    // involving either of them, since those desks just changed hands.
    const res = await WorkspaceModel.updateOne(
      {
        _id: ws._id,
        "deskRequests._id": r._id,
        members: { $all: [{ $elemMatch: { _id: from._id, desk: r.fromDesk } }, { $elemMatch: { _id: to._id, desk: r.toDesk } }] },
      },
      { $set: { "members.$[a].desk": r.toDesk, "members.$[b].desk": r.fromDesk }, $pull: { deskRequests: involving([from._id, to._id]) } },
      { arrayFilters: [{ "a._id": from._id }, { "b._id": to._id }] },
    );
    if (!res.modifiedCount) {
      req.log.warn({ id: ws.id, by: req.user!.email }, "⚠️  Swap accept lost a race: desks changed meanwhile");
      return reply.code(409).send({ message: "Desks just changed. Refresh and try again." });
    }
    req.log.info(
      { id: ws.id, swapped: [`${from.displayName}: ${label(r.fromDesk)} → ${label(r.toDesk)}`, `${to.displayName}: ${label(r.toDesk)} → ${label(r.fromDesk)}`] },
      "🔁 Desk swap accepted — saved to MongoDB",
    );
    return reply.send({ desk: r.fromDesk + 1, swappedWith: { memberId: mid(from), displayName: from.displayName, desk: r.toDesk + 1 } });
  });

  /** Decline a request sent to you, or cancel one you sent. */
  app.delete<{ Params: { id: string; requestId: string } }>("/:id/desk-requests/:requestId", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    const r = ws.deskRequests.find((x) => String(x._id) === req.params.requestId);
    if (!r) return reply.code(404).send(GONE);
    const role = String(r.from) === mid(me) ? "cancelled" : String(r.to) === mid(me) ? "declined" : null;
    if (!role) return reply.code(403).send({ message: "That swap request isn't yours." });
    await WorkspaceModel.updateOne({ _id: ws._id }, { $pull: { deskRequests: { _id: r._id } } });
    req.log.info({ id: ws.id, by: me.displayName, request: String(r._id) }, role === "cancelled" ? "↩️  Desk swap request cancelled" : "🙅 Desk swap request declined");
    const updated = (await WorkspaceModel.findById(ws._id))!;
    return reply.send({ [role]: true, requests: deskRequestsView(updated, updated.members.find((m) => mid(m) === mid(me))!) });
  });
};
