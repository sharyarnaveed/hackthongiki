"use client";

import { Unlink, Wallet } from "lucide-react";
import { useState } from "react";
import { ApiError, apiDelete, apiPost } from "@/lib/api";
import { WalletError, shortAddress, signInMessage } from "@/lib/wallet";

/**
 * Link a wallet to this account (Sign-In with Ethereum), so it can be used to
 * sign in next time. Shows the linked address with an unlink button once done.
 */
export function WalletLink({ wallet, onChange }: { wallet: string | null; onChange: (wallet: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ user: { wallet: string | null } }>) => {
    setBusy(true);
    setError(null);
    try {
      onChange((await action()).user.wallet);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof WalletError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const { message, signature } = await signInMessage("link");
      return apiPost("/api/auth/wallet/link", { message, signature });
    });
  const unlink = () => run(() => apiDelete("/api/auth/wallet"));

  const button =
    "inline-flex items-center gap-2 border-2 border-ink bg-paper-light px-3 py-2 text-sm font-semibold text-ink shadow-pixel-sm hover:-translate-y-0.5 disabled:opacity-60";

  return (
    <div className="relative">
      {wallet ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 border-2 border-ink bg-sun px-3 py-2 font-mono text-xs font-semibold text-ink" title={wallet}>
            <Wallet className="size-4" aria-hidden />
            <span aria-label={`Linked wallet ${wallet}`}>{shortAddress(wallet)}</span>
          </span>
          <button type="button" onClick={unlink} disabled={busy} className={button} aria-label="Unlink wallet" title="Unlink wallet">
            <Unlink className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button type="button" onClick={link} disabled={busy} className={button}>
          <Wallet className="size-4" aria-hidden />
          {busy ? "Check your wallet…" : "Link wallet"}
        </button>
      )}
      {error && (
        <p role="alert" className="absolute right-0 top-full z-10 mt-2 w-64 border-2 border-ink bg-paper-light p-2 text-xs text-terracotta shadow-pixel-sm">
          {error}
        </p>
      )}
    </div>
  );
}
