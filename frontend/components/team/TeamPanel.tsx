"use client";

import { ArrowLeftRight, Check, Copy, Crown, ExternalLink, Gem, RefreshCw, Send, Shield, Trash2, UserMinus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PixelSprite } from "@/components/pixel/PixelArt";
import { avatarById, avatarIdle } from "@/components/onboarding/avatars";
import { STATUS_DOT, STATUS_LABEL } from "@/components/office/hud";
import { ApiError } from "@/lib/api";
import {
  ROLE_LABEL,
  acceptSwap,
  canManage,
  canRemove,
  cancelInvitation,
  dropSwap,
  getInvite,
  getMembers,
  inviteEmails,
  moveMember,
  regenerateInvite,
  removeMember,
  requestSwap,
  resendInvitation,
  setRole,
  takeDesk,
  transferOwnership,
  updateInvite,
  type DeskRequest,
  type Invitation,
  type InviteCode,
  type MembersResponse,
  type Ownership,
  type Role,
  type TeamMember,
} from "./service";

/** What changed, so the office can reload when desks or roles move. */
export type TeamChange = "desks" | "roles" | "members" | "invitations" | "invite" | "swap-requests";

const small = "inline-flex items-center gap-1.5 border-2 border-ink px-2 py-1 text-xs font-semibold disabled:opacity-50";
const errText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

/** "3 min ago" for last-seen and sent times. */
function ago(iso?: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/**
 * Everyone in a workspace with their desk and status. Owners and admins also
 * manage the invite code, invitations, desks and members here; owners change
 * roles and hand the workspace over.
 */
export function TeamPanel({ workspaceId, onChange }: { workspaceId: string; onChange?: (what: TeamChange) => void }) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getMembers(workspaceId));
      setError(null);
    } catch (err) {
      setError(errText(err));
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Run an action, show its error or note, refresh the list and tell the parent. */
  const run = useCallback(
    async <T,>(action: () => Promise<T>, what: TeamChange, done?: string | ((result: T) => string)) => {
      setError(null);
      setNotice(null);
      try {
        const result = await action();
        if (done) setNotice(typeof done === "function" ? done(result) : done);
        await load();
        onChange?.(what);
        return true;
      } catch (err) {
        setError(errText(err));
        return false;
      }
    },
    [load, onChange],
  );

  if (!data) {
    return error ? <Alert tone="error">{error}</Alert> : <p className="animate-pulse text-muted">Loading the team…</p>;
  }

  const manager = canManage(data.role);
  const takenDesks = new Set(data.members.map((m) => m.desk).filter((d): d is number => d !== null));
  const requests = data.deskRequests ?? [];
  const myDesk = data.members.find((m) => m.you)?.desk ?? null;

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}

      {requests.length > 0 && <SwapRequestsSection workspaceId={workspaceId} requests={requests} run={run} />}

      <section aria-labelledby="team-members">
        <h3 id="team-members" className="mb-2 font-semibold">
          Members <span className="font-mono text-xs text-muted">({data.members.length})</span>
        </h3>
        <ul className="flex flex-col gap-2">
          {data.members.map((m) => (
            <MemberRow
              key={m.memberId}
              m={m}
              viewer={data.role}
              desks={data.desks}
              taken={takenDesks}
              run={run}
              workspaceId={workspaceId}
              // Members ask to swap; owners and admins swap directly with the desk picker.
              swap={!manager && !m.you && m.desk !== null && myDesk !== null ? (requests.some((r) => r.from.memberId === m.memberId || r.to.memberId === m.memberId) ? "pending" : "ask") : null}
            />
          ))}
        </ul>
      </section>

      {data.ownership && <OwnershipSection ownership={data.ownership} owner={data.members.find((m) => m.role === "owner")} />}

      {manager && <InviteCodeSection workspaceId={workspaceId} run={run} />}
      {manager && data.invitations && <InvitationsSection workspaceId={workspaceId} invitations={data.invitations} run={run} />}
    </div>
  );
}

/** "0x1234…abcd" */
const short = (hex: string) => (hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex);

/** The workspace's ownership NFT: where it is, and a link to it on the block explorer. */
function OwnershipSection({ ownership: o, owner }: { ownership: Ownership; owner?: TeamMember }) {
  const ownerName = owner ? (owner.you ? "you" : owner.displayName) : "the owner";
  return (
    <section aria-labelledby="team-nft" className="flex flex-col gap-2">
      <h3 id="team-nft" className="flex items-center gap-1.5 font-semibold">
        <Gem className="size-4 text-terracotta" aria-hidden />
        Ownership NFT
      </h3>
      <div className="flex flex-col gap-1 border-2 border-ink px-3 py-2 text-sm">
        {!o.minted ? (
          <p className="text-muted">{o.error ? "Not minted yet. Retrying shortly." : "Minting the token…"}</p>
        ) : (
          <>
            <p>
              Token <span className="font-mono">{short(o.tokenId)}</span>{" "}
              {o.inCustody ? (
                <>is held by TheSpace until {ownerName === "you" ? "you link" : `${ownerName} links`} a wallet.</>
              ) : (
                <>
                  is in {ownerName === "you" ? "your" : `${ownerName}'s`} wallet <span className="font-mono">{o.holder && short(o.holder)}</span>.
                </>
              )}
            </p>
            <p className="text-xs text-muted">Whoever holds it owns the workspace. It can only be sent to members with a linked wallet.</p>
          </>
        )}
        {o.minted && o.error && <p className="text-xs text-terracotta">Last sync failed: {o.error}. Retrying on its own.</p>}
        {o.url && o.minted && (
          <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-semibold underline">
            View on Snowtrace <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
    </section>
  );
}

type Run = <T>(action: () => Promise<T>, what: TeamChange, done?: string | ((result: T) => string)) => Promise<boolean>;

function Alert({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`border-2 border-ink px-3 py-2 text-sm ${tone === "error" ? "bg-terracotta/25" : "bg-sage/40"}`}>
      {children}
    </p>
  );
}

/** A button that asks "Sure?" on the first click. */
function ConfirmButton({ label, confirm, onConfirm, icon, danger }: { label: string; confirm: string; onConfirm: () => void; icon: ReactNode; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      className={`${small} ${armed ? (danger ? "bg-terracotta" : "bg-sun") : "bg-paper-light hover:bg-paper-deep"}`}
    >
      {icon}
      {armed ? confirm : label}
    </button>
  );
}

function MemberRow({
  m,
  viewer,
  desks,
  taken,
  run,
  workspaceId,
  swap,
}: {
  m: TeamMember;
  viewer: Role;
  desks: number;
  taken: Set<number>;
  run: Run;
  workspaceId: string;
  /** Whether the viewer can ask this person to swap desks, or already has a request open with them. */
  swap: "ask" | "pending" | null;
}) {
  const avatar = avatarById(m.avatarId);
  const manager = canManage(viewer);
  // Managers move anyone anywhere (swapping); everyone can move themselves to an open desk.
  const deskChoices = Array.from({ length: desks }, (_, i) => i + 1).filter((d) => manager || !taken.has(d) || d === m.desk);
  const canMoveDesk = desks > 0 && (manager || m.you);

  const changeDesk = (desk: number) =>
    run(() => (m.you ? takeDesk(workspaceId, desk) : moveMember(workspaceId, m.memberId, desk)), "desks", `${m.you ? "You're" : `${m.displayName} is`} now at desk ${desk}.`);

  return (
    <li className="flex flex-col gap-2 border-2 border-ink bg-paper px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden bg-sage/60">
          <PixelSprite sprite={avatarIdle(avatar)} className="w-6" label={`${m.displayName} as ${avatar.name}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-semibold">
            {m.role === "owner" && <Crown className="size-3.5 shrink-0 text-terracotta" aria-hidden />}
            {m.role === "admin" && <Shield className="size-3.5 shrink-0 text-forest" aria-hidden />}
            <span className="truncate">{m.displayName}</span>
            {m.you && <span className="font-normal text-muted">(you)</span>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{ROLE_LABEL[m.role]}</span>
            <span className="inline-flex items-center gap-1">
              <span className={`size-2 ${STATUS_DOT[m.status]}`} aria-hidden />
              {STATUS_LABEL[m.status]}
            </span>
            {m.online ? <span className="font-semibold text-forest">● in the office now</span> : <span>seen {ago(m.lastSeenAt)}</span>}
          </p>
        </div>
        {canMoveDesk ? (
          <label className="flex shrink-0 items-center gap-1 text-xs">
            <span className="sr-only">Desk for {m.displayName}</span>
            <span className="font-mono text-muted">desk</span>
            <select
              value={m.desk ?? ""}
              onChange={(e) => e.target.value && changeDesk(Number(e.target.value))}
              className="border-2 border-ink bg-paper-light px-1 py-0.5 font-mono"
            >
              {m.desk === null && <option value="">–</option>}
              {deskChoices.map((d) => (
                <option key={d} value={d}>
                  {d}
                  {taken.has(d) && d !== m.desk ? " (swap)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="shrink-0 font-mono text-xs text-muted">{m.desk ? `desk ${m.desk}` : "no desk"}</span>
        )}
      </div>

      {swap && (
        <div className="flex flex-wrap gap-2 border-t-2 border-dashed border-ink/15 pt-2">
          <button
            type="button"
            disabled={swap === "pending"}
            onClick={() => run(() => requestSwap(workspaceId, m.memberId), "swap-requests", `Asked ${m.displayName} to swap desks. They'll see it on the Members button in the office.`)}
            className={`${small} bg-paper-light hover:bg-paper-deep`}
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
            {swap === "pending" ? "Swap request open" : `Ask to swap for desk ${m.desk}`}
          </button>
        </div>
      )}

      {!m.you && (viewer === "owner" || canRemove(viewer, m.role)) && m.role !== "owner" && (
        <div className="flex flex-wrap gap-2 border-t-2 border-dashed border-ink/15 pt-2">
          {viewer === "owner" && (
            <button
              type="button"
              onClick={() => run(() => setRole(workspaceId, m.memberId, m.role === "admin" ? "member" : "admin"), "roles", `${m.displayName} is now ${m.role === "admin" ? "a member" : "an admin"}.`)}
              className={`${small} bg-paper-light hover:bg-paper-deep`}
            >
              <Shield className="size-3.5" aria-hidden />
              {m.role === "admin" ? "Make member" : "Make admin"}
            </button>
          )}
          {viewer === "owner" && (
            <ConfirmButton
              label="Make owner"
              confirm={`Hand over to ${m.displayName}?`}
              icon={<Crown className="size-3.5" aria-hidden />}
              onConfirm={() => run(() => transferOwnership(workspaceId, m.memberId), "roles", `${m.displayName} owns the workspace now. You're an admin.`)}
            />
          )}
          {canRemove(viewer, m.role) && (
            <ConfirmButton
              label="Remove"
              confirm="Really remove?"
              danger
              icon={<UserMinus className="size-3.5" aria-hidden />}
              onConfirm={() => run(() => removeMember(workspaceId, m.memberId), "members", `${m.displayName} was removed.`)}
            />
          )}
        </div>
      )}
    </li>
  );
}

const EXPIRY = [
  { days: null, label: "Never" },
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

function InviteCodeSection({ workspaceId, run }: { workspaceId: string; run: Run }) {
  const [invite, setInvite] = useState<InviteCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiry, setExpiry] = useState<string>("never");

  const load = useCallback(() => getInvite(workspaceId).then(setInvite).catch(() => setInvite(null)), [workspaceId]);
  useEffect(() => {
    load();
  }, [load]);

  const act = (fn: () => Promise<InviteCode>, done: string) =>
    run(async () => {
      setInvite(await fn());
    }, "invite", done);

  if (!invite) return null;
  const days = expiry === "never" ? null : Number(expiry);
  const state = invite.revoked ? "Turned off" : !invite.active ? "Expired" : invite.expiresAt ? `Works until ${new Date(invite.expiresAt).toLocaleDateString()}` : "Works until you turn it off";

  return (
    <section aria-labelledby="team-code" className="flex flex-col gap-2">
      <h3 id="team-code" className="font-semibold">
        Invitation code
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <code className={`border-2 border-ink px-3 py-1.5 font-mono text-lg tracking-widest ${invite.active ? "bg-sun/50" : "bg-paper-deep text-muted line-through"}`}>{invite.code}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(invite.code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className={`${small} bg-paper-light hover:bg-paper-deep`}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {state}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          Expires after
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="border-2 border-ink bg-paper-light px-1 py-0.5">
            {EXPIRY.map((o) => (
              <option key={o.label} value={o.days ?? "never"}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => act(() => updateInvite(workspaceId, { expiresInDays: days }), days ? `The code now expires in ${days} day${days === 1 ? "" : "s"}.` : "The code no longer expires.")} className={`${small} bg-paper-light hover:bg-paper-deep`}>
          Set expiry
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          label="New code"
          confirm="Old code stops working — sure?"
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          onConfirm={() => act(() => regenerateInvite(workspaceId, days), "New code ready. The old one no longer works.")}
        />
        {invite.revoked ? (
          <button type="button" onClick={() => act(() => updateInvite(workspaceId, { revoked: false }), "The code works again.")} className={`${small} bg-sage/60 hover:bg-sage`}>
            Turn code on
          </button>
        ) : (
          <ConfirmButton
            label="Turn code off"
            confirm="Nobody can join — sure?"
            danger
            icon={<Trash2 className="size-3.5" aria-hidden />}
            onConfirm={() => act(() => updateInvite(workspaceId, { revoked: true }), "Code turned off. Nobody can join with it.")}
          />
        )}
      </div>
    </section>
  );
}

function InvitationsSection({ workspaceId, invitations, run }: { workspaceId: string; invitations: Invitation[]; run: Run }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const emails = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!emails.length || busy) return;
    setBusy(true);
    const ok = await run(() => inviteEmails(workspaceId, emails), "invitations", (r) =>
      [
        r.sent ? `Sent ${r.sent} invitation${r.sent === 1 ? "" : "s"}.` : "",
        r.failed ? `${r.failed} email${r.failed === 1 ? "" : "s"} failed to send.` : "",
        r.skipped.length ? `Skipped ${r.skipped.map((x) => `${x.email} (${x.reason})`).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ") || "Nothing new to send.",
    );
    if (ok) setText("");
    setBusy(false);
  };

  return (
    <section aria-labelledby="team-invites" className="flex flex-col gap-2">
      <h3 id="team-invites" className="font-semibold">
        Invitations <span className="font-mono text-xs text-muted">({invitations.length} pending)</span>
      </h3>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="invite-emails" className="sr-only">
          Email addresses to invite
        </label>
        <input
          id="invite-emails"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="sam@team.co, lee@team.co"
          className="min-w-0 flex-1 border-2 border-ink bg-paper-light px-3 py-1.5 text-sm"
        />
        <button type="submit" disabled={busy || !text.trim()} className={`${small} bg-forest px-3 text-paper`}>
          <Send className="size-3.5" aria-hidden />
          {busy ? "Sending…" : "Invite"}
        </button>
      </form>
      {invitations.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {invitations.map((i) => (
            <li key={i.email} className="flex flex-wrap items-center gap-2 border-2 border-dashed border-ink/40 bg-paper px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{i.email}</span>
              <span className="text-xs text-muted">{i.sentAt ? `sent ${ago(i.sentAt)}${i.sendCount > 1 ? ` · ×${i.sendCount}` : ""}` : "not sent"}</span>
              <button type="button" onClick={() => run(() => resendInvitation(workspaceId, i.email), "invitations", `Sent again to ${i.email}.`)} className={`${small} bg-paper-light hover:bg-paper-deep`}>
                Resend
              </button>
              <button type="button" onClick={() => run(() => cancelInvitation(workspaceId, i.email), "invitations", `Cancelled the invitation for ${i.email}.`)} className={`${small} bg-paper-light hover:bg-terracotta`}>
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SwapRequestsSection({ workspaceId, requests, run }: { workspaceId: string; requests: DeskRequest[]; run: Run }) {
  return (
    <section aria-labelledby="team-swaps" className="flex flex-col gap-2">
      <h3 id="team-swaps" className="font-semibold">
        Desk swaps <span className="font-mono text-xs text-muted">({requests.length})</span>
      </h3>
      <ul className="flex flex-col gap-1.5">
        {requests.map((r) => (
          <li key={r.requestId} className="flex flex-wrap items-center gap-2 border-2 border-ink bg-sun/30 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              {r.direction === "incoming" ? (
                <>
                  <strong>{r.from.displayName}</strong> wants your desk {r.to.desk} and offers desk {r.from.desk}.
                </>
              ) : (
                <>
                  You asked <strong>{r.to.displayName}</strong> for desk {r.to.desk}.
                </>
              )}
            </span>
            {r.direction === "incoming" ? (
              <>
                <button
                  type="button"
                  onClick={() => run(() => acceptSwap(workspaceId, r.requestId), "desks", `Swapped. You're now at desk ${r.from.desk}.`)}
                  className={`${small} bg-sage/60 hover:bg-sage`}
                >
                  <Check className="size-3.5" aria-hidden />
                  Accept
                </button>
                <button type="button" onClick={() => run(() => dropSwap(workspaceId, r.requestId), "swap-requests", `Declined ${r.from.displayName}'s request.`)} className={`${small} bg-paper-light hover:bg-terracotta`}>
                  <X className="size-3.5" aria-hidden />
                  Decline
                </button>
              </>
            ) : (
              <button type="button" onClick={() => run(() => dropSwap(workspaceId, r.requestId), "swap-requests", "Request cancelled.")} className={`${small} bg-paper-light hover:bg-paper-deep`}>
                <X className="size-3.5" aria-hidden />
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
