"use client";

import { ExternalLink, Gem, Home, LogOut, ShoppingBag, Store, Tag, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { catalog } from "@/components/office/game/furniture";
import { THEMES, withDerived } from "@/components/office/game/themes";
import { PixelImage } from "@/components/pixel/PixelArt";
import { ApiError } from "@/lib/api";
import {
  getMarket,
  getMyDecor,
  parsePrice,
  placeDecor,
  removeDecor,
  sendDecorTx,
  type DecorAction,
  type Market,
  type MyDecor,
} from "@/lib/decorMarket";
import { WalletError, shortAddress } from "@/lib/wallet";

/** A workspace the viewer could put decor in (they must own it). */
export type DecorWorkspace = { workspaceId: string; name: string; role: string };

type Tab = "shop" | "market" | "mine";

const THEME = { ...THEMES["cozy-green"], palette: withDerived(THEMES["cozy-green"].palette) };
const DEFS = catalog(THEME) as Record<string, { frames: string[][] } | undefined>;

/** The decor drawn the way it looks in the office. */
export function DecorPreview({ kind, name }: { kind: string; name: string }) {
  const frame = DEFS[kind]?.frames[0];
  return (
    <div className="grid h-20 place-items-center border-2 border-ink bg-sage/30 p-2">
      {frame ? <PixelImage frame={frame} palette={THEME.palette} label={name} className="h-full w-auto" /> : <Gem className="size-8" aria-hidden />}
    </div>
  );
}

const btn = "inline-flex items-center justify-center gap-1.5 border-2 border-ink px-2.5 py-1.5 text-xs font-semibold shadow-pixel-sm hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50";
const errText = (err: unknown) => (err instanceof ApiError || err instanceof WalletError ? err.message : "Something went wrong. Try again.");

/**
 * The decor shop (new NFTs from the catalog), the marketplace (other people's listings)
 * and your own decor (place it in an office you own, sell it, or cancel a sale).
 * Buying and selling are transactions the viewer signs in their wallet.
 */
export function DecorMarket({ wallet, workspaces, onOfficeChanged }: { wallet: string | null; workspaces: DecorWorkspace[]; onOfficeChanged?: () => void }) {
  const [market, setMarket] = useState<Market | null>(null);
  const [mine, setMine] = useState<MyDecor[]>([]);
  const [tab, setTab] = useState<Tab>("shop");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const owned = useMemo(() => workspaces.filter((w) => w.role === "owner"), [workspaces]);

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([getMarket(), getMyDecor()]);
      setMarket(m);
      setMine(d.tokens);
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([getMarket(), getMyDecor()])
      .then(([m, d]) => {
        if (!alive) return;
        setMarket(m);
        setMine(d.tokens);
      })
      .catch((err) => alive && setError(errText(err)));
    return () => {
      alive = false;
    };
  }, []);

  /** Run one action: show "waiting", then the result or the error, then reload. */
  async function run(key: string, action: () => Promise<unknown>, done: string, officeChanged = false) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      if (officeChanged) onOfficeChanged?.();
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  }

  const tx = (key: string, action: DecorAction, done: string, officeChanged = false) => {
    if (!market?.enabled || !wallet) return;
    void run(key, () => sendDecorTx(market, wallet, action), done, officeChanged);
  };

  if (!market) return error ? <Alert tone="error">{error}</Alert> : <p className="animate-pulse text-muted">Opening the decor market…</p>;
  if (!market.enabled)
    return (
      <p className="border-2 border-ink bg-paper px-3 py-2 text-sm">
        The decor market isn&apos;t set up on this server yet. Deploy <span className="font-mono">OfficeDecor.sol</span> and set{" "}
        <span className="font-mono">DECOR_CONTRACT</span> in <span className="font-mono">backend/.env</span> (see <span className="font-mono">contracts/README.md</span>).
      </p>
    );

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: "shop", label: "Shop", icon: <ShoppingBag className="size-4" aria-hidden /> },
    { id: "market", label: "Market", icon: <Store className="size-4" aria-hidden />, count: market.listings.length },
    { id: "mine", label: "My decor", icon: <Gem className="size-4" aria-hidden />, count: mine.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      {!wallet && <Alert tone="info">Link a wallet on your dashboard to buy and sell decor. Prices are in test AVAX on Avalanche Fuji.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}
      {busy && <p className="text-xs text-muted" role="status">Waiting for your wallet and the blockchain… this can take a few seconds.</p>}

      <div role="tablist" aria-label="Decor market" className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`${btn} ${tab === t.id ? "bg-ink text-paper" : "bg-paper-light"}`}
          >
            {t.icon}
            {t.count === undefined ? t.label : `${t.label} (${t.count})`}
          </button>
        ))}
      </div>

      {tab === "shop" && (
        <Grid empty="The shop is empty. The app wallet adds items with npm run seed:decor.">
          {market.items.map((it) => (
            <Card key={it.itemId} kind={it.kind} name={it.name} sub={`${it.price} AVAX`}>
              <button
                type="button"
                className={`${btn} bg-sun`}
                disabled={!wallet || !it.forSale || !!busy}
                onClick={() => tx(`buy-${it.itemId}`, { type: "buy", itemId: it.itemId, priceWei: it.priceWei }, `You bought a ${it.name}. Find it in “My decor”.`)}
              >
                <ShoppingBag className="size-3.5" aria-hidden />
                {it.forSale ? (busy === `buy-${it.itemId}` ? "Buying…" : "Buy") : "Sold out"}
              </button>
            </Card>
          ))}
        </Grid>
      )}

      {tab === "market" && (
        <Grid empty="Nothing for sale right now. List your own decor from “My decor”.">
          {market.listings.map((l) => (
            <Card key={l.tokenId} kind={l.kind} name={l.name} sub={`${l.price} AVAX · from ${l.mine ? "you" : shortAddress(l.seller)}`}>
              {l.mine ? (
                <button type="button" className={`${btn} bg-paper-light`} disabled={!wallet || !!busy} onClick={() => tx(`cancel-${l.tokenId}`, { type: "cancel", tokenId: l.tokenId }, "Sale cancelled. It's back in your wallet.")}>
                  <X className="size-3.5" aria-hidden />
                  Cancel sale
                </button>
              ) : (
                <button
                  type="button"
                  className={`${btn} bg-sun`}
                  disabled={!wallet || !!busy}
                  onClick={() => tx(`take-${l.tokenId}`, { type: "buyListing", tokenId: l.tokenId, priceWei: l.priceWei }, `You bought the ${l.name}.`)}
                >
                  <ShoppingBag className="size-3.5" aria-hidden />
                  {busy === `take-${l.tokenId}` ? "Buying…" : `Buy for ${l.price}`}
                </button>
              )}
            </Card>
          ))}
        </Grid>
      )}

      {tab === "mine" && (
        <Grid empty={wallet ? "You don't have any decor yet. Buy some in the shop." : "Link a wallet to see your decor."}>
          {mine.map((d) => (
            <MyDecorCard key={d.tokenId} d={d} owned={owned} busy={busy} run={run} tx={tx} explorer={!!market.explorer} />
          ))}
        </Grid>
      )}
    </div>
  );
}

function MyDecorCard({
  d,
  owned,
  busy,
  run,
  tx,
  explorer,
}: {
  d: MyDecor;
  owned: DecorWorkspace[];
  busy: string | null;
  run: (key: string, action: () => Promise<unknown>, done: string, officeChanged?: boolean) => Promise<void>;
  tx: (key: string, action: DecorAction, done: string, officeChanged?: boolean) => void;
  explorer: boolean;
}) {
  const [where, setWhere] = useState(owned[0]?.workspaceId ?? "");
  const [price, setPrice] = useState("");
  const [selling, setSelling] = useState(false);
  const priceProblem = price ? parsePrice(price) : null;
  const status = d.listed ? `For sale: ${d.listed.price} AVAX` : d.placedIn ? `In “${d.placedIn.name}”` : "In your wallet";

  return (
    <Card kind={d.kind} name={d.name} sub={status}>
      <div className="flex flex-col gap-1.5">
        {d.listed ? (
          <button type="button" className={`${btn} bg-paper-light`} disabled={!!busy} onClick={() => tx(`cancel-${d.tokenId}`, { type: "cancel", tokenId: d.tokenId }, "Sale cancelled. It's back in your wallet.")}>
            <X className="size-3.5" aria-hidden />
            Cancel sale
          </button>
        ) : d.placedIn ? (
          <button
            type="button"
            className={`${btn} bg-paper-light`}
            disabled={!!busy}
            onClick={() => run(`out-${d.tokenId}`, () => removeDecor(d.placedIn!.workspaceId, d.tokenId), `The ${d.name} is back in your wallet.`, true)}
          >
            <LogOut className="size-3.5" aria-hidden />
            Take out of office
          </button>
        ) : owned.length ? (
          <div className="flex gap-1">
            <select aria-label={`Office for ${d.name}`} value={where} onChange={(e) => setWhere(e.target.value)} className="min-w-0 flex-1 border-2 border-ink bg-paper-light px-1 text-xs">
              {owned.map((w) => (
                <option key={w.workspaceId} value={w.workspaceId}>
                  {w.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${btn} bg-sage`}
              disabled={!where || !!busy}
              onClick={() => run(`in-${d.tokenId}`, () => placeDecor(where, d.tokenId), `The ${d.name} is in your office now, near the entrance. Move it with “Arrange”.`, true)}
            >
              <Home className="size-3.5" aria-hidden />
              Place
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted">Own a workspace to place decor in it.</p>
        )}

        {!d.listed &&
          (selling ? (
            <form
              className="flex flex-col gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (typeof parsePrice(price) === "string") return;
                tx(`list-${d.tokenId}`, { type: "list", tokenId: d.tokenId, price }, `Your ${d.name} is on the market for ${price} AVAX.`, !!d.placedIn);
              }}
            >
              <div className="flex gap-1">
                <input
                  aria-label={`Price for ${d.name} in AVAX`}
                  inputMode="decimal"
                  placeholder="0.05"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="min-w-0 flex-1 border-2 border-ink bg-paper-light px-1.5 text-xs"
                />
                <button type="submit" className={`${btn} bg-sun`} disabled={!price || typeof priceProblem === "string" || !!busy}>
                  List
                </button>
              </div>
              {typeof priceProblem === "string" && <p className="text-xs text-terracotta">{priceProblem}</p>}
              {d.placedIn && <p className="text-xs text-muted">Listing it takes it out of your office.</p>}
            </form>
          ) : (
            <button type="button" className={`${btn} bg-paper-light`} disabled={!!busy} onClick={() => setSelling(true)}>
              <Tag className="size-3.5" aria-hidden />
              Sell…
            </button>
          ))}

        {explorer && d.url && (
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold underline">
            Snowtrace <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
    </Card>
  );
}

function Grid({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (!children.length) return <p className="text-sm text-muted">{empty}</p>;
  return <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</ul>;
}

function Card({ kind, name, sub, children }: { kind: string; name: string; sub: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 border-2 border-ink bg-paper-light p-2">
      <DecorPreview kind={kind} name={name} />
      <div>
        <p className="text-sm font-semibold leading-tight">{name}</p>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      {children}
    </li>
  );
}

function Alert({ tone, children }: { tone: "error" | "ok" | "info"; children: ReactNode }) {
  const bg = tone === "error" ? "bg-terracotta/25" : tone === "ok" ? "bg-sage/40" : "bg-sun/40";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`border-2 border-ink px-3 py-2 text-sm ${bg}`}>
      {children}
    </p>
  );
}
