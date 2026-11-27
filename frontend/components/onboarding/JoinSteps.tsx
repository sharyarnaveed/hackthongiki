"use client";

import { Building2, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ErrorText } from "@/components/auth/fields";
import { PixelSprite } from "@/components/pixel/PixelArt";
import { avatarById, avatarWave } from "./avatars";
import { useOb } from "./context";
import { IdentityStep, StepFrame } from "./CreateSteps";
import { openWorkspace } from "@/components/office/config";
import { toJoinPayload, type JoinStepId } from "./model";
import { joinWorkspace, validateInvitationCode } from "./service";
import { Notice } from "./ui";
import { CODE_LENGTH, codeError, formatCode, normalizeCode } from "./validation";

type CheckState = { status: "idle" } | { status: "checking" } | { status: "unverified"; message: string };

function CodeStep() {
  const ob = useOb();
  const { data, errors, set, setErrors } = ob;
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  const submit = async () => {
    const err = codeError(data.invitationCode);
    if (err) {
      setErrors({ invitationCode: err });
      return;
    }
    setCheck({ status: "checking" });
    const result = await validateInvitationCode(data.invitationCode);
    if (result.ok) {
      setCheck({ status: "idle" });
      set({ workspacePreview: result.data });
      ob.next();
      return;
    }
    if (result.error === "invalid") {
      setCheck({ status: "idle" });
      setErrors({ invitationCode: result.message });
      return;
    }
    setCheck({ status: "unverified", message: result.message });
  };

  const error = errors.invitationCode;
  const describedBy = ["code-hint", error && "invitationCode-error", check.status === "unverified" && "code-unverified"]
    .filter(Boolean)
    .join(" ");

  return (
    <StepFrame
      eyebrow="Join a workspace"
      title="Your team saved you a spot."
      intro={<p>Enter the invitation code your teammate shared with you.</p>}
      primary={check.status === "checking" ? "Checking…" : "Join workspace"}
      onSubmit={submit}
    >
      <div>
        <label htmlFor="invitationCode" className="mb-1.5 block text-sm font-medium text-ink">
          Invitation code
        </label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="invitationCode"
            name="invitationCode"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD-2345"
            value={formatCode(data.invitationCode)}
            onChange={(e) => {
              set({ invitationCode: normalizeCode(e.target.value), workspacePreview: null });
              setCheck({ status: "idle" });
            }}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className="w-full border-2 border-ink bg-paper-light py-3.5 pl-12 pr-4 font-mono text-xl uppercase tracking-[0.25em] text-ink placeholder:normal-case placeholder:tracking-[0.25em] placeholder:text-muted/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed focus-visible:outline-forest aria-[invalid=true]:border-terracotta"
          />
        </div>
        <p id="code-hint" className="mt-1.5 text-xs text-muted">
          {CODE_LENGTH} letters and numbers. Spaces, dashes and lower case are fine — we tidy them up.
        </p>
        {error && <ErrorText id="invitationCode-error">{error}</ErrorText>}
      </div>

      {check.status === "unverified" && (
        <div id="code-unverified" role="alert" className="flex flex-col gap-3 border-2 border-ink bg-terracotta/20 p-4 text-sm text-ink">
          <p>
            <strong className="font-semibold">We can’t verify this code right now.</strong> {check.message} Try again in a moment.
          </p>
        </div>
      )}

      <p className="text-sm text-muted">
        <span className="font-semibold text-ink">Need an invitation code?</span> Ask your workspace administrator to
        invite you.
      </p>
    </StepFrame>
  );
}

function ConfirmStep() {
  const { data } = useOb();
  const router = useRouter();
  const avatar = avatarById(data.avatarId);
  const ws = data.workspacePreview;
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    // Only a code the server verified can be joined.
    if (!ws || joining) return;
    setJoining(true);
    setError(null);
    const result = await joinWorkspace(toJoinPayload(data));
    setJoining(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // The office page loads the joined workspace's saved office from the server.
    openWorkspace(result.data.workspaceId);
    router.push("/office/loading");
  };

  return (
    <StepFrame
      eyebrow="Confirm"
      title="Is this the right office?"
      intro={<p>Check the workspace below before you step inside.</p>}
      primary={joining ? "Joining…" : "Join this workspace"}
      onSubmit={join}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="border-2 border-dashed border-ink/50 bg-paper-deep/60 p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center border-2 border-dashed border-ink/40 text-muted">
              <Building2 className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-pixel text-xs uppercase tracking-widest text-muted">Workspace</p>
              <p className="font-semibold text-ink">{ws ? ws.name : "Not verified"}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Row k="Code">
              <span className="font-mono tracking-widest">{formatCode(data.invitationCode)}</span>
            </Row>
            <Row k="Invited by">{ws?.invitedBy ?? "—"}</Row>
            <Row k="Members">{ws ? ws.memberCount : "—"}</Row>
          </dl>
        </div>
        <div className="flex flex-col items-center justify-center border-2 border-ink bg-sage/50 px-6 py-3 shadow-pixel">
          <PixelSprite sprite={avatarWave(avatar)} label={`${avatar.name}, your avatar`} className="w-16" />
          <p className="mt-1 max-w-[10rem] truncate text-sm font-semibold text-ink">{data.displayName.trim()}</p>
          <p className="font-pixel text-[0.6rem] uppercase tracking-widest text-forest">That’s you</p>
        </div>
      </div>

      {error && (
        <Notice title="We couldn’t add you" tone="warn">
          {error}
        </Notice>
      )}
      {!ws && (
        <Notice title="Code not checked" tone="warn">
          Go back and enter your invitation code again so we can find your workspace.
        </Notice>
      )}
    </StepFrame>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-xs uppercase tracking-wide text-muted">{k}</dt>
      <dd className="text-ink">{children}</dd>
    </>
  );
}

export const JOIN_STEP_VIEWS: Record<JoinStepId, () => ReactNode> = {
  code: () => <CodeStep />,
  identity: () => <IdentityStep join />,
  confirm: () => <ConfirmStep />,
};
