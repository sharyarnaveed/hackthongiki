import type { FastifyBaseLogger } from "fastify";
import { formatEther, getAddress } from "viem";
import { live } from "../live/hub.ts";
import { ChainCursorModel } from "../models/ChainCursor.ts";
import { DecorItemModel, DecorTokenModel } from "../models/Decor.ts";
import { UserModel } from "../models/User.ts";
import { WorkspaceModel } from "../models/Workspace.ts";
import { decorConfigFromEnv, viemDecorChain, type DecorChain } from "./decorChain.ts";
import type { Ws } from "./workspace.ts";

/**
 * NFT decor: a shop and a marketplace (contracts/OfficeDecor.sol).
 *
 * People buy, list and sell from their own wallet in the browser. The backend keeps a copy of the
 * contract's state (catalog, tokens, listings) from its events, serves the market from it, and
 * lets a workspace owner place decor their linked wallet holds in their office. If the wallet stops
 * holding it (sold, listed, sent away, unlinked, or someone else became owner), it leaves the office.
 *
 * Off unless DECOR_CONTRACT is set.
 */

/** Office furniture a decor NFT can be: free-standing pieces the owner can move around. */
export const DECOR_KINDS = ["plant", "small-plant", "tree", "lamp", "beanbag", "record-player", "fireplace", "armchair", "bookshelf"] as const;
const KINDS = new Set<string>(DECOR_KINDS);

let chain: DecorChain | null = null;
let log: Pick<FastifyBaseLogger, "info" | "warn" | "error"> = { info() {}, warn() {}, error() {} };
const POLL_MS = 10_000;
const MAX_RANGE = 2000n;

export const decorEnabled = () => chain !== null;
const contractKey = () => chain!.contract.toLowerCase();
const cursorId = (c: DecorChain) => `decor:${c.chainId}:${c.contract.toLowerCase()}`;

/** Use this chain (tests pass an in-memory one); null turns the market off. */
export function useDecorChain(c: DecorChain | null, logger?: typeof log) {
  chain = c;
  if (logger) log = logger;
}

/* ───────────── Keeping the copy up to date ───────────── */

let syncing: Promise<void> | null = null;

/**
 * Catch up with the chain: the first time, read the whole catalog and every token;
 * after that, re-read only what new events touched. One run at a time.
 */
export function syncDecor(): Promise<void> {
  if (!chain) return Promise.resolve();
  syncing ??= catchUp(chain).finally(() => (syncing = null));
  return syncing;
}

async function catchUp(c: DecorChain) {
  const latest = await c.latestBlock();
  const cursor = await ChainCursorModel.findById(cursorId(c));
  if (!cursor) {
    const [items, next] = await Promise.all([c.itemCount(), c.nextTokenId()]);
    for (let i = 0n; i < items; i++) await refreshItem(c, i);
    for (let t = 1n; t < next; t++) await refreshToken(c, t);
    await ChainCursorModel.updateOne({ _id: cursorId(c) }, { $set: { block: Number(latest) } }, { upsert: true });
    log.info({ contract: c.contract, items: Number(items), tokens: Number(next - 1n) }, "🪴 Decor market loaded from the chain");
    return;
  }
  let from = BigInt(cursor.block) + 1n;
  while (from <= latest && chain === c) {
    const to = from + MAX_RANGE - 1n < latest ? from + MAX_RANGE - 1n : latest;
    const { items, tokens } = await c.changes(from, to);
    for (const i of items) await refreshItem(c, i);
    for (const t of tokens) await refreshToken(c, t);
    await ChainCursorModel.updateOne({ _id: cursorId(c) }, { $set: { block: Number(to) } }, { upsert: true });
    if (items.length || tokens.length) log.info({ items: items.map(Number), tokens: tokens.map(Number), blocks: `${from}–${to}` }, "🪴 Decor market updated");
    from = to + 1n;
  }
}

async function refreshItem(c: DecorChain, itemId: bigint) {
  const it = await c.item(itemId);
  await DecorItemModel.updateOne(
    { contract: c.contract.toLowerCase(), itemId: Number(itemId) },
    { $set: { name: it.name, kind: it.kind, priceWei: it.price.toString(), forSale: it.forSale } },
    { upsert: true },
  );
}

async function refreshToken(c: DecorChain, tokenId: bigint) {
  const key = { contract: c.contract.toLowerCase(), tokenId: Number(tokenId) };
  const t = await c.token(tokenId);
  if (!t) await DecorTokenModel.deleteOne(key);
  else
    await DecorTokenModel.updateOne(
      key,
      {
        $set: {
          itemId: Number(t.itemId),
          holder: t.holder.toLowerCase(),
          seller: t.listing?.seller.toLowerCase() ?? null,
          priceWei: t.listing?.price.toString() ?? null,
        },
      },
      { upsert: true },
    );
  // Wherever it's on display, check the office owner still holds it.
  const shown = await WorkspaceModel.find({ "office.objects.nft.tokenId": Number(tokenId) });
  for (const ws of shown) await pruneDecor(ws);
}

let pollTimer: NodeJS.Timeout | null = null;

export async function startDecor(logger: typeof log) {
  log = logger;
  const cfg = decorConfigFromEnv();
  if (!cfg) return log.info({}, "🪴 Decor market off (no DECOR_CONTRACT)");
  if ("problems" in cfg) return log.error({ problems: cfg.problems }, "🪴 Decor market off: fix these in backend/.env");
  const c = viemDecorChain(cfg);
  useDecorChain(c, logger);
  log.info({ chainId: c.chainId, contract: c.contract }, "🪴 Decor market on");
  const tick = async () => {
    await syncDecor().catch((err) => log.warn({ err: shortError(err) }, "🪴 Reading the decor contract failed; trying again shortly"));
    if (chain === c) pollTimer = setTimeout(tick, POLL_MS).unref();
  };
  void tick();
}

export async function stopDecor() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  await syncing;
  useDecorChain(null);
}

/* ───────────── Offices ───────────── */

type NftObject = { kind: string; tx: number; ty: number; nft?: { tokenId: number; name: string } };

/** The wallet (lowercase) of the workspace's owner, or null if they haven't linked one. */
export async function ownerWallet(ws: Ws) {
  const owner = ws.members.find((m) => m.role === "owner");
  if (!owner) return null;
  const user = await UserModel.findById(owner.userId, { walletAddress: 1 });
  return user?.walletAddress?.toLowerCase() ?? null;
}

/**
 * Take decor out of the office that its owner's wallet no longer holds.
 * Returns true if anything was removed (the office layout changed).
 */
export async function pruneDecor(ws: Ws): Promise<boolean> {
  const objects = ((ws.office as { objects?: NftObject[] } | null)?.objects ?? []).filter((o) => o.nft);
  if (!objects.length) return false;
  const wallet = await ownerWallet(ws);
  let keep = new Set<number>();
  if (wallet && chain) {
    const held = await DecorTokenModel.find({ contract: contractKey(), tokenId: { $in: objects.map((o) => o.nft!.tokenId) }, holder: wallet }, { tokenId: 1 });
    keep = new Set(held.map((t) => t.tokenId));
  }
  // With the market off nothing can be checked, so decor stays as it is.
  if (!chain) return false;
  const gone = objects.filter((o) => !keep.has(o.nft!.tokenId)).map((o) => o.nft!.tokenId);
  if (!gone.length) return false;
  // Straight to the collection: Mongoose would turn "nft.tokenId" into an exact match on the whole `nft` object.
  await WorkspaceModel.collection.updateOne(
    { _id: ws._id },
    { $pull: { "office.objects": { "nft.tokenId": { $in: gone } } } as never, $inc: { layoutVersion: 1 }, $set: { layoutSavedAt: new Date() } },
  );
  log.info({ workspace: ws.id, removed: gone, why: wallet ? "owner's wallet doesn't hold them" : "owner has no wallet linked" }, "🪴 Decor taken out of the office");
  const fresh = await WorkspaceModel.findById(ws._id);
  if (fresh?.office) live.officeChanged(ws.id, fresh.office as never, { id: "", name: "Decor market" });
  return true;
}

/* ───────────── What the market shows ───────────── */

const avax = (wei: string) => formatEther(BigInt(wei));

/** Catalog, open listings, and the contract details the browser needs to send transactions. */
export async function marketView(wallet: string | null) {
  if (!chain) return { enabled: false as const };
  const contract = contractKey();
  const me = wallet?.toLowerCase() ?? null;
  const [items, listed] = await Promise.all([
    DecorItemModel.find({ contract }).sort({ itemId: 1 }),
    DecorTokenModel.find({ contract, seller: { $ne: null } }).sort({ updatedAt: -1 }).limit(200),
  ]);
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return {
    enabled: true as const,
    chainId: chain.chainId,
    contract: chain.contract,
    explorer: chain.explorer,
    items: items
      .filter((i) => KINDS.has(i.kind))
      .map((i) => ({ itemId: i.itemId, name: i.name, kind: i.kind, priceWei: i.priceWei, price: avax(i.priceWei), forSale: i.forSale })),
    listings: listed.flatMap((t) => {
      const it = byId.get(t.itemId);
      if (!it || !KINDS.has(it.kind)) return [];
      return [{ tokenId: t.tokenId, itemId: t.itemId, name: it.name, kind: it.kind, seller: getAddress(t.seller!), priceWei: t.priceWei!, price: avax(t.priceWei!), mine: t.seller === me }];
    }),
  };
}

/** Decor the wallet holds or has listed, and which office each piece is in. */
export async function myDecorView(wallet: string | null) {
  if (!chain || !wallet) return { tokens: [] };
  const contract = contractKey();
  const w = wallet.toLowerCase();
  const [tokens, items] = await Promise.all([
    DecorTokenModel.find({ contract, $or: [{ holder: w }, { seller: w }] }).sort({ tokenId: 1 }),
    DecorItemModel.find({ contract }),
  ]);
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const ids = tokens.map((t) => t.tokenId);
  const offices = ids.length ? await WorkspaceModel.find({ "office.objects.nft.tokenId": { $in: ids } }, { name: 1, "office.objects.nft": 1 }) : [];
  const placedIn = new Map<number, { workspaceId: string; name: string }>();
  for (const ws of offices)
    for (const o of ((ws.office as { objects?: NftObject[] } | null)?.objects ?? []))
      if (o.nft) placedIn.set(o.nft.tokenId, { workspaceId: ws.id, name: ws.name });
  return {
    tokens: tokens.flatMap((t) => {
      const it = byId.get(t.itemId);
      if (!it) return [];
      return [
        {
          tokenId: t.tokenId,
          itemId: t.itemId,
          name: it.name,
          kind: it.kind,
          listed: t.seller ? { priceWei: t.priceWei!, price: avax(t.priceWei!) } : null,
          placedIn: placedIn.get(t.tokenId) ?? null,
          url: chain!.explorer ? `${chain!.explorer}/nft/${chain!.contract}/${t.tokenId}` : null,
        },
      ];
    }),
  };
}

/** The token as the office needs it to place it, if the wallet holds it (not listed). */
export async function heldToken(wallet: string, tokenId: number) {
  if (!chain) return null;
  const t = await DecorTokenModel.findOne({ contract: contractKey(), tokenId, holder: wallet.toLowerCase() });
  if (!t) return null;
  const it = await DecorItemModel.findOne({ contract: contractKey(), itemId: t.itemId });
  if (!it || !KINDS.has(it.kind)) return null;
  return { tokenId, name: it.name, kind: it.kind };
}

function shortError(err: unknown) {
  const e = err as { shortMessage?: string; message?: string };
  return (e?.shortMessage ?? e?.message ?? String(err)).split("\n")[0].slice(0, 300);
}
