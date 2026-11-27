"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ErrorText, Field } from "@/components/auth/fields";
import { LIMITS } from "@/components/onboarding/model";
import { ApiError, apiDelete, apiPatch } from "@/lib/api";
import { TeamPanel } from "@/components/team/TeamPanel";
import type { WorkspaceSummary } from "./Dashboard";

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 font-display" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-dialog-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={`w-full ${wide ? "max-w-xl" : "max-w-md"} border-2 border-ink bg-paper-light shadow-[8px_8px_0_0_var(--color-ink)]`}
      >
        <div className="flex items-center justify-between border-b-2 border-ink bg-paper px-5 py-3">
          <h2 id="ws-dialog-title" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center hover:bg-ink hover:text-paper">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="max-h-[75dvh] overflow-y-auto p-5">{children}</div>
      </motion.div>
    </div>
  );
}

const btn = "inline-flex items-center justify-center gap-2 border-2 border-ink px-4 py-2.5 font-semibold shadow-pixel-sm hover:-translate-y-0.5 disabled:opacity-60";

/** Owner: rename the workspace or change its description. */
export function EditWorkspaceDialog({
  ws,
  onClose,
  onSaved,
}: {
  ws: WorkspaceSummary;
  onClose: () => void;
  onSaved: (w: Partial<WorkspaceSummary>) => void;
}) {
  const [name, setName] = useState(ws.name);
  const [description, setDescription] = useState(ws.description ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setErrors({ workspaceName: "Your office needs a name on the door." });
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const updated = await apiPatch<WorkspaceSummary>(`/api/workspaces/${encodeURIComponent(ws.workspaceId)}`, {
        workspaceName: name.trim(),
        workspaceDescription: description.trim(),
      });
      onSaved(updated);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setErrors(apiErr?.fieldErrors ?? {});
      setFormError(apiErr?.message ?? "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog title="Edit workspace" onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          id="workspaceName"
          label="Workspace name"
          value={name}
          maxLength={LIMITS.workspaceName}
          onChange={(e) => {
            setName(e.target.value);
            setErrors({});
          }}
          error={errors.workspaceName}
          autoFocus
        />
        <div>
          <label htmlFor="workspaceDescription" className="mb-1.5 block text-sm font-medium text-ink">
            Description <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id="workspaceDescription"
            value={description}
            maxLength={LIMITS.workspaceDescription}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none border-2 border-ink bg-paper-light px-4 py-3 text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed focus-visible:outline-forest"
          />
          <p className="mt-1 text-right font-mono text-xs text-muted">
            {description.length}/{LIMITS.workspaceDescription}
          </p>
        </div>
        {formError && <ErrorText id="edit-error">{formError}</ErrorText>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={`${btn} bg-paper text-ink`}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={`${btn} bg-forest text-paper`}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Owner: delete for everyone (type the name to confirm). Member: leave. */
export function DeleteWorkspaceDialog({ ws, onClose, onDone }: { ws: WorkspaceSummary; onClose: () => void; onDone: () => void }) {
  const owner = ws.role === "owner";
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !owner || confirm.trim() === ws.name;

  const go = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/workspaces/${encodeURIComponent(ws.workspaceId)}`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog title={owner ? "Delete workspace" : "Leave workspace"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-ink/80">
          {owner ? (
            <>
              This permanently deletes <strong className="text-ink">{ws.name}</strong> and its office for all {ws.memberCount} member
              {ws.memberCount === 1 ? "" : "s"}. This can’t be undone.
            </>
          ) : (
            <>
              You’ll leave <strong className="text-ink">{ws.name}</strong>. You can rejoin later with an invitation code.
            </>
          )}
        </p>
        {owner && (
          <Field
            id="confirmName"
            label={`Type “${ws.name}” to confirm`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        )}
        {error && <ErrorText id="delete-error">{error}</ErrorText>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={`${btn} bg-paper text-ink`}>
            Cancel
          </button>
          <button type="button" onClick={go} disabled={busy || !ready} className={`${btn} bg-terracotta text-ink`}>
            {busy ? (owner ? "Deleting…" : "Leaving…") : owner ? "Delete workspace" : "Leave workspace"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Everyone in the workspace; owners and admins manage invitations, desks and roles here. */
export function MembersDialog({ ws, onClose, onChanged }: { ws: WorkspaceSummary; onClose: () => void; onChanged: () => void }) {
  return (
    <Dialog title={`Members · ${ws.name}`} onClose={onClose} wide>
      <TeamPanel workspaceId={ws.workspaceId} onChange={onChanged} />
    </Dialog>
  );
}
