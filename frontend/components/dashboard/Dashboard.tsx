"use client";

import { motion } from "framer-motion";
import { ArrowRight, Crown, DoorOpen, Gem, LogOut, Pencil, Plus, RefreshCw, Shield, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BRAND } from "@/components/landing/brand";
import { Logo } from "@/components/landing/Logo";
import { MotionProvider } from "@/components/motion/Motion";
import { avatarById, avatarIdle } from "@/components/onboarding/avatars";
import { LAYOUTS, PURPOSES, STYLES, labelOf } from "@/components/onboarding/model";
import { forgetWorkspace, openWorkspace, storedWorkspaceId } from "@/components/office/config";
import { resetPreparedOffice } from "@/components/office/prepare";
import { PixelSprite } from "@/components/pixel/PixelArt";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { DeleteWorkspaceDialog, Dialog, EditWorkspaceDialog, MembersDialog } from "./WorkspaceDialogs";
import { DecorMarket } from "@/components/market/DecorMarket";
import { WalletLink } from "./WalletLink";
import { ROLE_LABEL, type Role } from "@/components/team/service";

type Me = { id: string; fullName: string; email: string; wallet: string | null };

export type WorkspaceSummary = {
  workspaceId: string;
  name: string;
  description: string;
  memberCount: number;
  purpose: string;
  teamSize: string;
  workspaceStyle: string;
  officeLayout: string;
  officeFeatures: string[];
  role: Role;
  displayName: string;
  avatarId: string;
};

/** Accent colour of each workspace card, by its chosen style. */
const STYLE_ACCENT: Record<string, string> = {
  "cozy-green": "bg-forest text-paper",
  "creative-studio": "bg-terracotta text-ink",
  "quiet-minimal": "bg-paper-deep text-ink",
  "community-lounge": "bg-sun text-ink",
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; me: Me; workspaces: WorkspaceSummary[] };

/** Signed-in home: every workspace the user owns or belongs to, plus "create" up top. */
export function Dashboard() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [signingOut, setSigningOut] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSummary | null>(null);
  const [removing, setRemoving] = useState<WorkspaceSummary | null>(null);
  const [team, setTeam] = useState<WorkspaceSummary | null>(null);
  const [shopping, setShopping] = useState(false);
  // Something changed in the members dialog (roles, members): refresh the cards when it closes.
  const [teamChanged, setTeamChanged] = useState(false);

  const replace = (updated: WorkspaceSummary) =>
    setState((s) => (s.status === "ready" ? { ...s, workspaces: s.workspaces.map((w) => (w.workspaceId === updated.workspaceId ? updated : w)) } : s));
  const drop = (id: string) => {
    if (storedWorkspaceId() === id) forgetWorkspace();
    resetPreparedOffice();
    setState((s) => (s.status === "ready" ? { ...s, workspaces: s.workspaces.filter((w) => w.workspaceId !== id) } : s));
  };

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [{ user }, { workspaces }] = await Promise.all([
        apiGet<{ user: Me }>("/api/auth/me"),
        apiGet<{ workspaces: WorkspaceSummary[] }>("/api/workspaces/mine"),
      ]);
      setState({ status: "ready", me: user, workspaces });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/signin?next=${encodeURIComponent("/dashboard")}`);
        return;
      }
      setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (id: string) => {
    openWorkspace(id);
    resetPreparedOffice();
    router.push("/office/loading");
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiPost("/api/auth/signout", {});
    } catch {
      // Cookie may already be gone; send them to sign in either way.
    }
    router.replace("/signin");
  };

  const me = state.status === "ready" ? state.me : null;
  const workspaces = state.status === "ready" ? state.workspaces : [];

  return (
    <MotionProvider>
      <main className="min-h-dvh bg-sage/45 px-4 py-5 font-display sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-6xl border-2 border-ink bg-paper-light shadow-[8px_8px_0_0_var(--color-ink)]">
          {/* Top bar */}
          <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-paper px-5 py-4 sm:px-8">
            <Link href="/" aria-label={`${BRAND.name} home`} className="inline-flex rounded-sm">
              <Logo />
            </Link>
            <div className="flex items-center gap-3">
              {me && (
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-semibold leading-tight text-ink">{me.fullName}</p>
                  <p className="text-xs text-muted">{me.email}</p>
                </div>
              )}
              {me && (
                <WalletLink
                  wallet={me.wallet}
                  onChange={(wallet) => setState((s) => (s.status === "ready" ? { ...s, me: { ...s.me, wallet } } : s))}
                />
              )}
              {me && (
                <button
                  type="button"
                  onClick={() => setShopping(true)}
                  className="inline-flex items-center gap-2 border-2 border-ink bg-sun px-3 py-2 text-sm font-semibold text-ink shadow-pixel-sm hover:-translate-y-0.5"
                >
                  <Gem className="size-4" aria-hidden />
                  Decor market
                </button>
              )}
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="inline-flex items-center gap-2 border-2 border-ink bg-paper-light px-3 py-2 text-sm font-semibold text-ink shadow-pixel-sm hover:-translate-y-0.5 disabled:opacity-60"
              >
                <LogOut className="size-4" aria-hidden />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </header>

          {/* Title + create action on top */}
          <section className="flex flex-col gap-5 border-b-2 border-dashed border-ink/20 px-5 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div>
              <p className="font-pixel text-xs uppercase tracking-widest text-terracotta">● Dashboard</p>
              <h1 className="mt-3 text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-4xl">
                {me ? <>Hi {me.fullName.split(" ")[0]}, pick an office.</> : "Your workspaces"}
              </h1>
              <p className="mt-2 max-w-md text-muted">Every workspace you own or have joined lives here. Create as many as you like.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/onboarding?mode=join"
                className="inline-flex items-center gap-2 border-2 border-ink bg-paper px-4 py-3 font-semibold text-ink shadow-pixel-sm hover:-translate-y-0.5"
              >
                <DoorOpen className="size-4" aria-hidden />
                Join with a code
              </Link>
              <Link
                href="/onboarding?mode=create"
                className="group inline-flex items-center gap-2 border-2 border-ink bg-forest px-5 py-3 font-semibold text-paper shadow-pixel hover:-translate-y-0.5"
              >
                <Plus className="size-4" aria-hidden />
                Create workspace
              </Link>
            </div>
          </section>

          <section className="px-5 py-8 sm:px-8 sm:py-10" aria-live="polite">
            {state.status === "loading" && (
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading workspaces">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="h-56 animate-pulse border-2 border-ink/30 bg-paper" />
                ))}
              </ul>
            )}

            {state.status === "error" && (
              <div className="flex flex-col items-start gap-4 border-2 border-ink bg-terracotta/20 p-5">
                <p className="font-semibold text-ink">Couldn’t load your workspaces.</p>
                <p className="text-sm text-ink/80">{state.message}</p>
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center gap-2 border-2 border-ink bg-paper px-3 py-2 text-sm font-semibold shadow-pixel-sm hover:-translate-y-0.5"
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Try again
                </button>
              </div>
            )}

            {state.status === "ready" && workspaces.length === 0 && (
              <div className="flex flex-col items-center gap-4 border-2 border-dashed border-ink/40 bg-paper px-6 py-14 text-center">
                <p className="font-pixel text-xs uppercase tracking-widest text-forest">No offices yet</p>
                <h2 className="text-2xl font-semibold text-ink">Build your first workspace</h2>
                <p className="max-w-sm text-muted">Pick a layout and a style, invite your team, and walk in.</p>
                <Link
                  href="/onboarding?mode=create"
                  className="inline-flex items-center gap-2 border-2 border-ink bg-forest px-5 py-3 font-semibold text-paper shadow-pixel hover:-translate-y-0.5"
                >
                  <Plus className="size-4" aria-hidden />
                  Create workspace
                </Link>
              </div>
            )}

            {state.status === "ready" && workspaces.length > 0 && (
              <>
                <p className="mb-4 font-mono text-sm text-muted">
                  {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
                </p>
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {workspaces.map((ws, i) => (
                    <WorkspaceCard
                      key={ws.workspaceId}
                      ws={ws}
                      index={i}
                      onOpen={() => open(ws.workspaceId)}
                      onEdit={() => setEditing(ws)}
                      onRemove={() => setRemoving(ws)}
                      onMembers={() => setTeam(ws)}
                    />
                  ))}
                  <li>
                    <Link
                      href="/onboarding?mode=create"
                      className="flex h-full min-h-56 flex-col items-center justify-center gap-3 border-2 border-dashed border-ink/40 bg-paper p-5 text-center font-semibold text-forest hover:border-ink hover:bg-paper-deep"
                    >
                      <span className="grid size-12 place-items-center border-2 border-ink bg-paper-light shadow-pixel-sm">
                        <Plus className="size-5" aria-hidden />
                      </span>
                      New workspace
                    </Link>
                  </li>
                </ul>
              </>
            )}
          </section>
        </div>
      </main>
      {editing && (
        <EditWorkspaceDialog
          ws={editing}
          onClose={() => setEditing(null)}
          onSaved={(w) => {
            replace({ ...editing, ...w });
            resetPreparedOffice();
            setEditing(null);
          }}
        />
      )}
      {team && (
        <MembersDialog
          ws={team}
          onChanged={() => {
            setTeamChanged(true);
            resetPreparedOffice();
          }}
          onClose={() => {
            setTeam(null);
            if (teamChanged) load();
            setTeamChanged(false);
          }}
        />
      )}
      {shopping && me && (
        <Dialog title="Decor market" wide onClose={() => setShopping(false)}>
          <DecorMarket
            wallet={me.wallet}
            workspaces={workspaces.map((w) => ({ workspaceId: w.workspaceId, name: w.name, role: w.role }))}
            onOfficeChanged={resetPreparedOffice}
          />
        </Dialog>
      )}
      {removing && (
        <DeleteWorkspaceDialog
          ws={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            drop(removing.workspaceId);
            setRemoving(null);
          }}
        />
      )}
    </MotionProvider>
  );
}

function WorkspaceCard({
  ws,
  index,
  onOpen,
  onEdit,
  onRemove,
  onMembers,
}: {
  ws: WorkspaceSummary;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onMembers: () => void;
}) {
  const owner = ws.role === "owner";
  const avatar = avatarById(ws.avatarId);
  const accent = STYLE_ACCENT[ws.workspaceStyle] ?? STYLE_ACCENT["cozy-green"];
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      className="group flex flex-col border-2 border-ink bg-paper shadow-pixel"
    >
      <div className={`flex items-end justify-between gap-3 border-b-2 border-ink px-4 pt-4 ${accent}`}>
        <div className="min-w-0 pb-3">
          <p className="font-pixel text-[0.6rem] uppercase tracking-widest opacity-80">{labelOf(LAYOUTS, ws.officeLayout)}</p>
          <h2 className="mt-1 truncate text-xl font-semibold tracking-[-0.02em]" title={ws.name}>
            {ws.name}
          </h2>
        </div>
        <PixelSprite sprite={avatarIdle(avatar)} hover label={`${ws.displayName} as ${avatar.name}`} className="w-11 shrink-0" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-2 min-h-10 text-sm text-ink/80">{ws.description || labelOf(STYLES, ws.workspaceStyle)}</p>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 border-2 border-ink bg-paper-light px-2 py-0.5">
            {ws.role === "owner" ? <Crown className="size-3" aria-hidden /> : ws.role === "admin" ? <Shield className="size-3" aria-hidden /> : null}
            {ROLE_LABEL[ws.role] ?? "Member"}
          </span>
          <button
            type="button"
            onClick={onMembers}
            aria-label={`Members of ${ws.name}`}
            className="inline-flex items-center gap-1 border-2 border-ink bg-paper-light px-2 py-0.5 hover:bg-sun"
          >
            <Users className="size-3" aria-hidden />
            {ws.memberCount} · Members
          </button>
          <span className="border-2 border-ink bg-paper-light px-2 py-0.5">{labelOf(PURPOSES, ws.purpose)}</span>
        </div>
        <div className="mt-auto flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex flex-1 items-center justify-center gap-2 border-2 border-ink bg-forest px-4 py-2.5 font-semibold text-paper shadow-pixel-sm hover:-translate-y-0.5"
        >
          Enter office
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
        </button>
        {owner && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${ws.name}`}
            title="Edit"
            className="grid w-11 place-items-center border-2 border-ink bg-paper-light text-ink shadow-pixel-sm hover:-translate-y-0.5 hover:bg-sun"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={owner ? `Delete ${ws.name}` : `Leave ${ws.name}`}
          title={owner ? "Delete" : "Leave"}
          className="grid w-11 place-items-center border-2 border-ink bg-paper-light text-ink shadow-pixel-sm hover:-translate-y-0.5 hover:bg-terracotta"
        >
          {owner ? <Trash2 className="size-4" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
        </button>
        </div>
      </div>
    </motion.li>
  );
}
