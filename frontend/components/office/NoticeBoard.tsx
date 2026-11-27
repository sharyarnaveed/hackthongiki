"use client";

import { Pin, PinOff, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { NOTE_COLORS, addNotice, deleteNotice, getNotices, updateNotice, type Notice, type NoteColor } from "./lifeService";

const MAX_TEXT = 280;
const btn = "inline-flex items-center justify-center gap-1.5 border-2 border-ink px-3 py-1.5 text-sm font-semibold disabled:opacity-60";
const iconBtn = "grid size-7 place-items-center border-2 border-ink bg-paper-light hover:bg-sun disabled:opacity-60";
const errText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

const NOTE_BG: Record<NoteColor, string> = { sun: "bg-sun/70", sage: "bg-sage/70", terracotta: "bg-terracotta/45", paper: "bg-paper" };
const NOTE_NAME: Record<NoteColor, string> = { sun: "Yellow", sage: "Green", terracotta: "Orange", paper: "White" };

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * The workspace's notice board. Everyone reads it; the owner pins, edits and
 * takes down notes. Notes live in the `notices` collection.
 */
export function NoticeBoard({ workspaceId }: { workspaceId: string }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [max, setMax] = useState(30);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getNotices(workspaceId)
      .then((r) => {
        if (!live) return;
        setNotices(r.notices);
        setCanEdit(r.canEdit);
        setMax(r.max);
      })
      .catch((err) => live && setLoadError(errText(err)));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  /** Run a change; the server answers with the whole board. */
  const run = async (id: string, fn: () => Promise<{ notices: Notice[] }>) => {
    setBusy(id);
    setError(null);
    try {
      setNotices((await fn()).notices);
      return true;
    } catch (err) {
      setError(errText(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <p role="alert" className="text-terracotta">
        {loadError}
      </p>
    );
  }
  if (!notices) return <p className="text-muted">Reading the board…</p>;

  return (
    <>
      {canEdit && (
        <NoteForm
          submitLabel="Pin to the board"
          busy={busy === "new"}
          disabled={notices.length >= max}
          onSubmit={(draft) => run("new", () => addNotice(workspaceId, draft))}
        />
      )}
      {canEdit && notices.length >= max && <p className="text-xs text-muted">The board is full ({max} notes). Take one down to add another.</p>}
      {error && (
        <p role="alert" className="text-sm text-terracotta">
          {error}
        </p>
      )}
      {notices.length === 0 ? (
        <p className="border-2 border-dashed border-ink/40 bg-paper px-3 py-4 text-center text-muted">
          {canEdit ? "The board is empty. Pin the first note for your team." : "Nothing on the board yet. The owner pins notes here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Notes on the board">
          {notices.map((n) => (
            <li key={n.noticeId} className={`relative border-2 border-ink px-3 pb-2 pt-3 shadow-pixel-sm ${NOTE_BG[n.color] ?? NOTE_BG.sun}`}>
              {n.pinned && <Pin aria-label="Pinned" className="absolute -top-2.5 left-2 size-4 fill-terracotta text-ink" />}
              {editing === n.noticeId ? (
                <NoteForm
                  initial={n}
                  submitLabel="Save note"
                  busy={busy === n.noticeId}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (draft) => {
                    const ok = await run(n.noticeId, () => updateNotice(workspaceId, n.noticeId, draft));
                    if (ok) setEditing(null);
                    return ok;
                  }}
                />
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-snug">{n.text}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="font-mono text-[0.7rem] text-ink/70">
                      {n.authorName} · {when(n.createdAt)}
                      {n.updatedAt !== n.createdAt && " · edited"}
                    </p>
                    {canEdit && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className={iconBtn}
                          disabled={busy !== null}
                          aria-label={n.pinned ? "Unpin note" : "Pin note to the top"}
                          title={n.pinned ? "Unpin" : "Pin to the top"}
                          onClick={() => run(n.noticeId, () => updateNotice(workspaceId, n.noticeId, { pinned: !n.pinned }))}
                        >
                          {n.pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
                        </button>
                        <button type="button" className={iconBtn} disabled={busy !== null} aria-label="Edit note" title="Edit" onClick={() => setEditing(n.noticeId)}>
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          disabled={busy !== null}
                          aria-label="Take note down"
                          title="Take down"
                          onClick={() => run(n.noticeId, () => deleteNotice(workspaceId, n.noticeId))}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Write or edit a note: text, colour and (for new notes) whether it's pinned. */
function NoteForm({
  initial,
  submitLabel,
  busy,
  disabled = false,
  onSubmit,
  onCancel,
}: {
  initial?: Notice;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSubmit: (draft: { text: string; color: NoteColor; pinned?: boolean }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [color, setColor] = useState<NoteColor>(initial?.color ?? "sun");
  const [pinned, setPinned] = useState(false);
  const id = initial?.noticeId ?? "new";
  const changed = text.trim() && (!initial || text.trim() !== initial.text || color !== initial.color);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || busy || disabled) return;
    const draft = initial ? { text: text.trim(), color } : { text: text.trim(), color, pinned };
    // A new note that made it onto the board clears the form for the next one.
    if ((await onSubmit(draft)) && !initial) {
      setText("");
      setPinned(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={initial ? "Edit note" : "New note"}>
      <label className="flex flex-col gap-1">
        <span className={initial ? "sr-only" : "font-semibold"}>{initial ? "Note" : "New note"}</span>
        <textarea
          value={text}
          rows={3}
          maxLength={MAX_TEXT}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          placeholder="Lunch at 1? Standup moved to 10:30…"
          className="resize-y border-2 border-ink bg-paper-light px-3 py-2"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Note colour</legend>
          {NOTE_COLORS.map((c) => (
            <label key={c} title={NOTE_NAME[c]} className="cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-dashed has-[:focus-visible]:outline-forest">
              <input type="radio" name={`note-color-${id}`} className="sr-only" checked={color === c} onChange={() => setColor(c)} aria-label={NOTE_NAME[c]} />
              <span aria-hidden className={`block size-6 border-2 border-ink ${NOTE_BG[c]} ${color === c ? "ring-2 ring-ink ring-offset-1" : ""}`} />
            </label>
          ))}
          {!initial && (
            <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4 accent-forest" />
              Pin to the top
            </label>
          )}
        </fieldset>
        <span className="font-mono text-[0.7rem] text-muted" aria-live="polite">
          {text.length}/{MAX_TEXT}
        </span>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!changed || busy || disabled} className={`${btn} bg-forest text-paper`}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`${btn} bg-paper-light hover:bg-paper-deep`}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
