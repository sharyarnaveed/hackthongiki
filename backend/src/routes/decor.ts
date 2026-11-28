import type { FastifyPluginAsync } from "fastify";
import { blocksTheWay, entranceTiles, placementProblem, tilesOf, type LayoutFloor } from "@/components/office/game/layoutEdit";
import type { OfficeMap, PlacedObject } from "@/components/office/game/map";
import { live } from "../live/hub.ts";
import { decorEnabled, heldToken, marketView, myDecorView, syncDecor } from "../lib/decor.ts";
import { rateLimiter } from "../lib/onboarding.ts";
import { requireAuth } from "../lib/session.ts";
import { NOT_FOUND, memberWorkspace, mid } from "../lib/workspace.ts";
import { WorkspaceModel } from "../models/Workspace.ts";
import { furnitureMeta } from "./officeLife.ts";

const OFF = { message: "The decor market isn't set up on this server yet." };
const NO_WALLET = { message: "Link a wallet on your dashboard first: decor lives in your wallet." };

// "I just sent a transaction, update now": 30 per user per minute.
const syncLimit = rateLimiter(30, 60 * 1000);

/** The shop, the marketplace and your decor. Buying and selling happen in the browser wallet. */
export const marketRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireAuth);

  /** Catalog and open listings, plus the contract to send transactions to. */
  app.get("/", async (req) => marketView(req.user!.wallet));

  /** Decor your linked wallet holds or has listed, and where each piece is placed. */
  app.get("/mine", async (req) => ({ wallet: req.user!.wallet, ...(await myDecorView(req.user!.wallet)) }));

  /** Read new contract events now (the browser calls this after a transaction is mined). */
  app.post("/sync", async (req, reply) => {
    if (!decorEnabled()) return reply.code(404).send(OFF);
    if (!syncLimit(req.user!.id)) return reply.code(429).send({ message: "Slow down a little and try again." });
    await syncDecor();
    return reply.send({ ok: true });
  });
};

/** How far from the entrance we look for a free spot for new decor. */
const MAX_TRIES = 600;

/**
 * The first spot near the entrance where `obj` fits with the same rules as moving furniture
 * (inside the walls, nothing in the way, doesn't box anything off), or null.
 */
export function freeSpot(office: OfficeMap, obj: PlacedObject) {
  const meta = furnitureMeta(office);
  // Leave a one-tile gap around the entrance so new decor doesn't crowd the doorway.
  const nearDoor = new Set(entranceTiles(office.spawn).flatMap(({ tx, ty }) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => `${tx + dx},${ty + dy}`))));
  const before: LayoutFloor = office;
  const seen = new Set<string>();
  // The spawn point can sit between two tiles (e.g. tx 13.5); objects need whole tiles.
  const start = { tx: Math.floor(office.spawn.tx), ty: Math.floor(office.spawn.ty) };
  const queue = [start];
  seen.add(`${start.tx},${start.ty}`);
  for (let tries = 0; queue.length && tries < MAX_TRIES; tries++) {
    const at = queue.shift()!;
    const candidate = { ...obj, tx: at.tx, ty: at.ty };
    const next: LayoutFloor = { ...office, objects: [...office.objects, candidate] };
    const crowdsDoor = tilesOf(candidate, meta).some((t) => nearDoor.has(`${t.tx},${t.ty}`));
    if (!crowdsDoor && !placementProblem(next, [next.objects.length - 1], meta) && !blocksTheWay(before, next, meta)) return { tx: at.tx, ty: at.ty };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = at.tx + dx;
      const ty = at.ty + dy;
      const k = `${tx},${ty}`;
      if (seen.has(k) || tx < 1 || ty < 2 || tx >= office.width - 1 || ty >= office.height - 1 || office.walls[ty]?.[tx]) continue;
      seen.add(k);
      queue.push({ tx, ty });
    }
  }
  return null;
}

/** Owner: put decor from your wallet into the office, or take it out. Registered inside `workspaceRoutes`. */
export const decorRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: { tokenId: number } }>(
    "/:id/decor",
    { schema: { body: { type: "object", required: ["tokenId"], additionalProperties: false, properties: { tokenId: { type: "integer", minimum: 1 } } } } },
    async (req, reply) => {
      if (!decorEnabled()) return reply.code(404).send(OFF);
      const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
      if (!found) return reply.code(404).send(NOT_FOUND);
      const { ws, me } = found;
      if (me.role !== "owner") return reply.code(403).send({ message: "Only the workspace owner can decorate the office." });
      const wallet = req.user!.wallet;
      if (!wallet) return reply.code(409).send(NO_WALLET);
      const { tokenId } = req.body;
      const token = await heldToken(wallet, tokenId);
      if (!token) return reply.code(404).send({ message: "Your wallet doesn't hold that decor (or it's listed for sale)." });

      const elsewhere = await WorkspaceModel.findOne({ "office.objects.nft.tokenId": tokenId }, { name: 1 });
      if (elsewhere) {
        const here = elsewhere.id === ws.id;
        return reply.code(409).send({ message: here ? "It's already in this office." : `It's in “${elsewhere.name}”. Take it out there first.` });
      }
      const office = ws.office as OfficeMap | null;
      if (!office || !Array.isArray(office.objects)) return reply.code(409).send({ message: "Open the office once before decorating it." });

      const obj = { kind: token.kind, tx: 0, ty: 0, nft: { tokenId, name: token.name } } as PlacedObject;
      const spot = freeSpot(office, obj);
      if (!spot) return reply.code(409).send({ message: "There's no free floor space near the entrance. Move some furniture first." });
      const version = ws.layoutVersion ?? 0;
      // Only if nobody changed the layout meanwhile (the owner's other tab, or a rebuild).
      const res = await WorkspaceModel.updateOne(
        { _id: ws._id, officeSavedAt: ws.officeSavedAt, layoutVersion: version === 0 ? { $in: [0, null] } : version },
        { $push: { "office.objects": { ...obj, ...spot } }, $inc: { layoutVersion: 1 }, $set: { layoutSavedAt: new Date() } },
      );
      if (!res.modifiedCount) return reply.code(409).send({ message: "The office just changed. Try again." });
      req.log.info({ id: ws.id, by: me.displayName, tokenId, kind: token.kind, at: spot }, "🪴 Decor placed in the office");
      const fresh = await WorkspaceModel.findById(ws._id);
      if (fresh?.office) live.officeChanged(ws.id, fresh.office as never, { id: mid(me), name: me.displayName });
      return reply.code(201).send({ tokenId, kind: token.kind, ...spot });
    },
  );

  app.delete<{ Params: { id: string; tokenId: string } }>("/:id/decor/:tokenId", async (req, reply) => {
    const found = await memberWorkspace(req.params.id, req.user!.id, req.log);
    if (!found) return reply.code(404).send(NOT_FOUND);
    const { ws, me } = found;
    if (me.role !== "owner") return reply.code(403).send({ message: "Only the workspace owner can decorate the office." });
    const tokenId = Number(req.params.tokenId);
    // Straight to the collection: Mongoose would turn "nft.tokenId" into an exact match on the whole `nft` object.
    const res = await WorkspaceModel.collection.updateOne(
      { _id: ws._id, "office.objects.nft.tokenId": tokenId },
      { $pull: { "office.objects": { "nft.tokenId": tokenId } } as never, $inc: { layoutVersion: 1 }, $set: { layoutSavedAt: new Date() } },
    );
    if (!res.modifiedCount) return reply.code(404).send({ message: "That decor isn't in this office." });
    req.log.info({ id: ws.id, by: me.displayName, tokenId }, "🪴 Decor taken out of the office");
    const fresh = await WorkspaceModel.findById(ws._id);
    if (fresh?.office) live.officeChanged(ws.id, fresh.office as never, { id: mid(me), name: me.displayName });
    return reply.send({ removed: tokenId });
  });
};

