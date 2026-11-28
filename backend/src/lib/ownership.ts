import type { FastifyBaseLogger } from "fastify";
import { Types } from "mongoose";
import { getAddress, type Address } from "viem";
import { ChainCursorModel } from "../models/ChainCursor.ts";
import { UserModel } from "../models/User.ts";
import { WorkspaceModel } from "../models/Workspace.ts";
import { ZERO, chainConfigFromEnv, tokenIdOf, viemChain, workspaceIdOf, type OwnershipChain, type Transfer } from "./chain.ts";
import { assignDesks } from "./desks.ts";
import { sendOwnershipEmail } from "./mailer.ts";
import { handOver, saveDesks, type Ws } from "./workspace.ts";

/**
 * Keeps each workspace's ownership NFT in step with the app.
 *
 * App → chain (`syncWorkspace`): after anything that changes who owns a workspace, who's in it,
 * or which wallets they've linked, the workspace is queued and reconciled:
 *   - the token exists (minted into the app's custody),
 *   - the members' linked wallets are the ones allowed to receive it,
 *   - it sits in the owner's linked wallet, or in custody when they have none,
 *   - a deleted workspace's token is burned.
 * Reconciling compares with the chain first, so it's safe to run any number of times.
 *
 * Chain → app (`pollTransfers`): when a holder sends the token to another member's wallet
 * (only members are allowed, the contract enforces it), that member becomes the owner here.
 *
 * Everything is off unless OWNERSHIP_CONTRACT and CHAIN_PRIVATE_KEY are set: then these are no-ops.
 */

let chain: OwnershipChain | null = null;
let log: Pick<FastifyBaseLogger, "info" | "warn" | "error"> = { info() {}, warn() {}, error() {} };

/** Wait between watcher polls. */
const POLL_MS = 10_000;
/** Most blocks asked for in one log query (public RPCs cap this, Fuji at 2048). */
const MAX_RANGE = 2000n;
/** Retry a failed sync after 30 s, 1 min, 2 min … up to 10 min, then give up until the next change. */
const RETRY_BASE_MS = 30_000;
const MAX_TRIES = 6;

export const onchainEnabled = () => chain !== null;

/** Use this chain (tests pass an in-memory one). `null` turns on-chain ownership off. */
export function useChain(c: OwnershipChain | null, logger?: typeof log) {
  chain = c;
  if (logger) log = logger;
  queue.clear();
  tries.clear();
  for (const t of retryTimers.values()) clearTimeout(t);
  retryTimers.clear();
}

/* ───────────── App → chain ───────────── */

const queue = new Set<string>();
const tries = new Map<string, number>();
const retryTimers = new Map<string, NodeJS.Timeout>();
let draining: Promise<void> | null = null;

/** Bring this workspace's token in line with the app (soon, in the background). */
export function syncWorkspace(workspaceId: unknown) {
  if (!chain) return;
  queue.add(String(workspaceId));
  draining ??= drain().finally(() => (draining = null));
}

/** Sync every workspace this user is in (they linked or unlinked a wallet). */
export async function syncUserWorkspaces(userId: string) {
  if (!chain) return;
  const list = await WorkspaceModel.find({ "members.userId": userId }, { _id: 1 });
  for (const ws of list) syncWorkspace(ws._id);
}

/** Resolves once nothing is queued or running (tests and shutdown). */
export async function onchainIdle() {
  while (draining) await draining;
}

async function drain() {
  // All transactions come from one wallet, so they go one at a time.
  while (queue.size && chain) {
    const id = queue.values().next().value!;
    queue.delete(id);
    try {
      await reconcile(chain, id);
      tries.delete(id);
    } catch (err) {
      const n = (tries.get(id) ?? 0) + 1;
      tries.set(id, n);
      const reason = shortError(err);
      await WorkspaceModel.updateOne({ _id: id, chain: { $exists: true } }, { $set: { "chain.error": reason } }).catch(() => {});
      if (n < MAX_TRIES) {
        const wait = Math.min(RETRY_BASE_MS * 2 ** (n - 1), 10 * 60_000);
        log.warn({ workspace: id, try: n, retryInSeconds: wait / 1000, err: reason }, "⛓️  Ownership sync failed, will retry");
        clearTimeout(retryTimers.get(id));
        retryTimers.set(id, setTimeout(() => (retryTimers.delete(id), syncWorkspace(id)), wait).unref());
      } else {
        log.error({ workspace: id, err: reason }, "⛓️  Ownership sync gave up (it runs again on the next change or restart)");
        tries.delete(id);
      }
    }
  }
}

async function reconcile(c: OwnershipChain, id: string) {
  const tokenId = tokenIdOf(id);
  const ws = await WorkspaceModel.findById(id);

  // Deleted workspace: burn its token.
  if (!ws) {
    if (await c.exists(tokenId)) {
      const tx = await c.burn(tokenId);
      log.info({ workspace: id, tx }, "🔥 Ownership token burned (workspace deleted)");
    }
    return;
  }

  // Members' linked wallets, and the owner's.
  const users = await UserModel.find({ _id: { $in: ws.members.map((m) => m.userId) }, walletAddress: { $exists: true, $ne: null } }, { walletAddress: 1 });
  const owner = ws.members.find((m) => m.role === "owner");
  const wallets = new Set(users.map((u) => u.walletAddress!.toLowerCase()));
  const ownerWallet = users.find((u) => String(u._id) === String(owner?.userId))?.walletAddress?.toLowerCase();
  const wantHolder = (ownerWallet ?? c.app).toLowerCase();

  const recorded = new Set(ws.chain?.allowed ?? []);
  const allow = [...wallets].filter((w) => !recorded.has(w));
  const revoke = [...recorded].filter((w) => !wallets.has(w));
  const txs: string[] = [];
  if (allow.length) txs.push(await c.setAllowed(tokenId, allow.map((w) => getAddress(w)), true));
  if (revoke.length) txs.push(await c.setAllowed(tokenId, revoke.map((w) => getAddress(w)), false));

  let minted = false;
  if (!(await c.exists(tokenId))) {
    txs.push(await c.mint(tokenId));
    minted = true;
  }
  const holder = (await c.ownerOf(tokenId)).toLowerCase();
  if (holder !== wantHolder) txs.push(await c.syncTransfer(tokenId, getAddress(wantHolder)));

  await WorkspaceModel.updateOne(
    { _id: ws._id },
    { $set: { "chain.minted": true, "chain.holder": wantHolder, "chain.allowed": [...wallets], "chain.syncedAt": new Date() }, $unset: { "chain.error": 1 } },
    { timestamps: false },
  );
  if (txs.length)
    log.info(
      {
        workspace: id,
        minted,
        allowed: allow.length,
        revoked: revoke.length,
        holder: wantHolder === c.app.toLowerCase() ? "app custody" : wantHolder,
        moved: holder !== wantHolder,
        txs,
      },
      "⛓️  Ownership token synced",
    );
}

/* ───────────── Chain → app ───────────── */

let pollTimer: NodeJS.Timeout | null = null;
let polling: Promise<void> | null = null;

const cursorId = (c: OwnershipChain) => `${c.chainId}:${c.contract.toLowerCase()}`;

/**
 * Read new token transfers and apply the ones a holder made themselves.
 * The first run starts at the current block; after that it resumes from the saved cursor.
 */
export async function pollTransfers() {
  const c = chain;
  if (!c) return;
  const latest = await c.latestBlock();
  const cursor = await ChainCursorModel.findById(cursorId(c));
  let from = cursor ? BigInt(cursor.block) + 1n : latest;
  while (from <= latest && chain === c) {
    const to = from + MAX_RANGE - 1n < latest ? from + MAX_RANGE - 1n : latest;
    for (const t of await c.transfers(from, to)) await applyTransfer(c, t);
    await ChainCursorModel.updateOne({ _id: cursorId(c) }, { $set: { block: Number(to) } }, { upsert: true });
    from = to + 1n;
  }
}

async function applyTransfer(c: OwnershipChain, t: Transfer) {
  // Mints and burns, and anything the app sent itself, are already reflected here.
  if (t.from === ZERO || t.to === ZERO || t.txSender.toLowerCase() === c.app.toLowerCase()) return;
  const id = workspaceIdOf(t.tokenId);
  if (!id || !Types.ObjectId.isValid(id)) return;
  const to = t.to.toLowerCase();
  const where = { workspace: id, tx: t.txHash, to: t.to };

  // A later transfer may have moved it on already: only act if this wallet still holds it.
  let holder: Address;
  try {
    holder = await c.ownerOf(t.tokenId);
  } catch {
    return;
  }
  if (holder.toLowerCase() !== to) return log.info(where, "⛓️  Skipped an old token transfer (it has moved since)");

  const ws = await WorkspaceModel.findById(id);
  if (!ws) return syncWorkspace(id); // deleted meanwhile: burn
  if (to === c.app.toLowerCase()) {
    // The holder handed it back to custody; the app still says who owns it, so it goes back to them.
    log.info(where, "⛓️  Token sent back to the app; putting it back with the owner");
    return syncWorkspace(id);
  }
  const user = await UserModel.findOne({ walletAddress: to }, { _id: 1, email: 1, fullName: 1 });
  const target = user && ws.members.find((m) => String(m.userId) === String(user._id));
  if (!target) {
    // Only possible in a race (the member left before their wallet was revoked): move it back.
    log.warn(where, "⛓️  Token reached a wallet that isn't a member here; moving it back to the owner");
    return syncWorkspace(id);
  }
  if (target.role === "owner") return syncWorkspace(id);

  const from = ws.members.find((m) => m.role === "owner");
  if (!(await handOver(ws, from, target))) {
    log.warn(where, "⚠️  On-chain transfer lost a race with a role change; syncing again");
    return syncWorkspace(id);
  }
  log.info({ ...where, from: from?.displayName, newOwner: target.displayName }, "👑 Ownership transferred on chain — saved to MongoDB");
  const updated = await WorkspaceModel.findById(id);
  if (updated) await saveDesks(updated, assignDesks(updated), "ownership transferred on chain", log as FastifyBaseLogger);
  try {
    await sendOwnershipEmail(user!.email, user!.fullName, ws.name, from?.displayName ?? "The previous owner");
  } catch (err) {
    log.error({ ...where, err: shortError(err) }, "❌ New-owner email failed");
  }
  syncWorkspace(id);
}

/* ───────────── Start / stop ───────────── */

/**
 * Turn on-chain ownership on if the env has a contract and key: check the key owns the
 * contract, sync every workspace once, then watch the chain.
 */
export async function startOnchain(logger: typeof log) {
  log = logger;
  const cfg = chainConfigFromEnv();
  if (!cfg) return log.info({}, "⛓️  On-chain ownership off (no OWNERSHIP_CONTRACT / CHAIN_PRIVATE_KEY)");
  if ("problems" in cfg) return log.error({ problems: cfg.problems }, "⛓️  On-chain ownership off: fix these in backend/.env");
  const c = viemChain(cfg);
  try {
    const owner = await c.contractOwner();
    if (owner.toLowerCase() !== c.app.toLowerCase()) {
      return log.error({ contract: c.contract, contractOwner: owner, keyAddress: c.app }, "⛓️  On-chain ownership off: CHAIN_PRIVATE_KEY isn't the contract's app wallet");
    }
  } catch (err) {
    return log.error({ contract: c.contract, err: shortError(err) }, "⛓️  On-chain ownership off: couldn't reach the contract (check the address, RPC and chain id)");
  }
  useChain(c, logger);
  log.info({ chainId: c.chainId, contract: c.contract, app: c.app }, "⛓️  On-chain ownership on");

  const all = await WorkspaceModel.find({}, { _id: 1 });
  for (const ws of all) syncWorkspace(ws._id);

  const tick = async () => {
    polling = pollTransfers().catch((err) => log.warn({ err: shortError(err) }, "⛓️  Reading token transfers failed; trying again shortly"));
    await polling;
    polling = null;
    if (chain === c) pollTimer = setTimeout(tick, POLL_MS).unref();
  };
  void tick();
}

export async function stopOnchain() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  await polling;
  await onchainIdle();
  useChain(null);
}

/* ───────────── For the members panel ───────────── */

/** The workspace's token as the members panel shows it, or null when on-chain ownership is off. */
export function ownershipView(ws: Ws) {
  if (!chain) return null;
  const tokenId = tokenIdOf(ws.id);
  const holder = ws.chain?.holder ?? null;
  return {
    chainId: chain.chainId,
    contract: chain.contract,
    tokenId: `0x${ws.id}`,
    minted: !!ws.chain?.minted,
    holder: holder ? getAddress(holder) : null,
    inCustody: holder === chain.app.toLowerCase(),
    syncedAt: ws.chain?.syncedAt ?? null,
    error: ws.chain?.error ?? null,
    url: chain.explorer ? `${chain.explorer}/nft/${chain.contract}/${tokenId}` : null,
    contractUrl: chain.explorer ? `${chain.explorer}/address/${chain.contract}` : null,
  };
}

/** A one-line reason: viem errors carry a short message plus pages of detail. */
function shortError(err: unknown) {
  const e = err as { shortMessage?: string; message?: string };
  return (e?.shortMessage ?? e?.message ?? String(err)).split("\n")[0].slice(0, 300);
}

