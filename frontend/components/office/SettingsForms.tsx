"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AvatarPicker } from "@/components/onboarding/AvatarPicker";
import { LIMITS, STYLES, type StyleId } from "@/components/onboarding/model";
import { ApiError } from "@/lib/api";
import { planConfig, type OfficeConfig } from "./config";
import { ALL_FEATURES, FEATURES, featureOf, type FeatureId } from "./features";
import { generateOffice } from "./game/map";

const btn = "inline-flex items-center justify-center border-2 border-ink px-3 py-2 text-sm font-semibold disabled:opacity-60";
const errText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

/** Change your name tag and avatar in this workspace. */
export function ProfileForm({ config, onSave }: { config: OfficeConfig; onSave: (patch: { displayName?: string; avatarId?: string }) => Promise<void> }) {
  const [name, setName] = useState(config.displayName);
  const [avatar, setAvatar] = useState<string>(config.avatarId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== config.displayName || avatar !== config.avatarId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || busy) return;
    if (!name.trim()) return setError("Tell us what to put on your name tag.");
    setBusy(true);
    setError(null);
    try {
      const patch: { displayName?: string; avatarId?: string } = {};
      if (name.trim() !== config.displayName) patch.displayName = name.trim();
      if (avatar !== config.avatarId) patch.avatarId = avatar;
      await onSave(patch);
    } catch (err) {
      setError(errText(err));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="profile-title">
      <h3 id="profile-title" className="font-semibold">
        Your name tag & avatar
      </h3>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name tag</span>
        <input
          value={name}
          maxLength={LIMITS.displayName}
          onChange={(e) => setName(e.target.value)}
          className="border-2 border-ink bg-paper-light px-3 py-2"
          aria-invalid={!!error}
        />
      </label>
      <AvatarPicker value={avatar} onChange={setAvatar} legend="Avatar" compact />
      {error && (
        <p role="alert" className="text-sm text-terracotta">
          {error}
        </p>
      )}
      <button type="submit" disabled={!changed || busy} className={`${btn} self-start bg-forest text-paper`}>
        {busy ? "Saving…" : "Save name tag & avatar"}
      </button>
    </form>
  );
}

/** Owner: change the office's style and which furniture is placed. */
export function LookForm({ config, onSave }: { config: OfficeConfig; onSave: (change: { workspaceStyle?: string; officeFeatures?: string[] }) => Promise<void> }) {
  const [style, setStyle] = useState<StyleId>(config.workspaceStyle);
  const [ticked, setTicked] = useState<FeatureId[]>(config.features ?? ALL_FEATURES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only offer what this building has room for (e.g. a bed only at home).
  const available = useMemo(() => {
    const present = new Set(generateOffice({ ...planConfig(config.layout, config.teamSize), features: ALL_FEATURES }).objects.map((o) => featureOf(o.kind)));
    return FEATURES.filter((f) => present.has(f.id));
  }, [config.layout, config.teamSize]);

  const original = [...(config.features ?? ALL_FEATURES)].sort().join();
  const changed = style !== config.workspaceStyle || [...ticked].sort().join() !== original;
  const toggle = (id: FeatureId) => setTicked((t) => (t.includes(id) ? t.filter((f) => f !== id) : [...t, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ workspaceStyle: style, officeFeatures: ticked });
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="look-title">
      <h3 id="look-title" className="font-semibold">
        Style & furniture
      </h3>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Style</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {STYLES.map((s) => (
            <label key={s.id} className={`cursor-pointer border-2 border-ink px-2 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-dashed has-[:focus-visible]:outline-forest ${style === s.id ? "bg-sun" : "bg-paper-light hover:bg-paper-deep"}`}>
              <input type="radio" name="look-style" className="sr-only" checked={style === s.id} onChange={() => setStyle(s.id)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Furniture</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {available.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 border-2 border-ink bg-paper-light px-2 py-1.5 text-xs font-medium has-[:checked]:bg-sage/60">
              <input type="checkbox" className="size-3.5 accent-forest" checked={ticked.includes(f.id)} onChange={() => toggle(f.id)} />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted">Saving rebuilds the office for everyone. People start at the door next time.</p>
      {error && (
        <p role="alert" className="text-sm text-terracotta">
          {error}
        </p>
      )}
      <button type="submit" disabled={!changed || busy} className={`${btn} self-start bg-forest text-paper`}>
        {busy ? "Rebuilding…" : "Save style & furniture"}
      </button>
    </form>
  );
}
