"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { PixelSprite } from "@/components/pixel/PixelArt";
import { avatarById, avatarWave } from "@/components/onboarding/avatars";
import { LAYOUTS, PURPOSES, STYLES, TEAM_SIZES, labelOf, tierOf, type LayoutId } from "@/components/onboarding/model";
import type { OfficeConfig } from "./config";
import { seatLabel, type Seat } from "./game/seating";

const SEAT_DOT: Record<Seat["kind"], string> = { mine: "bg-sun", member: "bg-forest", invited: "bg-sage", open: "bg-paper-light" };
import { PlanPicker } from "@/components/onboarding/PlanPicker";
import { STATUS_DOT, STATUS_LABEL, officeBadge, type Settings, type Status } from "./hud";
import { TeamPanel, type TeamChange } from "@/components/team/TeamPanel";
import { LookForm, ProfileForm } from "./SettingsForms";
import { NoticeBoard } from "./NoticeBoard";
import { OfficeStats } from "./OfficeStats";

export type PanelId = "desk" | "workspace" | "meeting" | "break" | "settings" | "members" | "notices" | "stats";

const TITLES: Record<PanelId, string> = {
  desk: "Your desk",
  workspace: "Workspace",
  meeting: "Meeting room",
  break: "Break time",
  settings: "Settings",
  members: "Members",
  notices: "Notice board",
  stats: "Office stats",
};

/** What the settings and members panels can change; each returns once the office has reloaded. */
export type OfficeActions = {
  onPlan: (layout: LayoutId, teamSize: string) => void;
  onLook: (change: { workspaceStyle?: string; officeFeatures?: string[] }) => Promise<void>;
  onProfile: (patch: { displayName?: string; avatarId?: string }) => Promise<void>;
  onTeam: (what: TeamChange) => void;
  /** Owner: close the panel and start moving furniture. */
  onArrange: () => void;
  /** Open another panel (e.g. the notice board from the workspace panel). */
  onOpen: (id: PanelId) => void;
};

/** The meeting room / call booth panel: which room you're in and who's already on its call. */
export type MeetingInfo = { room: string; canCall: boolean; inCall: string[]; full: boolean; onJoin: () => void };

export function OfficePanel({
  id,
  seats,
  meeting,
  config,
  status,
  onStatus,
  settings,
  onSettings,
  actions,
  onClose,
}: {
  id: PanelId;
  /** Team desks in order (desk 1 is the player's). */
  seats: Seat[];
  config: OfficeConfig;
  status: Status;
  onStatus: (s: Status) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  actions: OfficeActions;
  onClose: () => void;
  meeting?: MeetingInfo;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  let body: ReactNode;
  if (id === "desk") body = <Desk config={config} status={status} onStatus={onStatus} />;
  else if (id === "workspace") body = <Workspace config={config} seats={seats} onOpen={actions.onOpen} />;
  else if (id === "notices") body = config.workspaceId ? <NoticeBoard workspaceId={config.workspaceId} /> : null;
  else if (id === "stats") body = config.workspaceId ? <OfficeStats workspaceId={config.workspaceId} /> : null;
  else if (id === "meeting") body = <Meeting info={meeting} />;
  else if (id === "break") body = <Break />;
  else if (id === "members") body = config.workspaceId ? <TeamPanel workspaceId={config.workspaceId} onChange={actions.onTeam} /> : null;
  else body = <SettingsBody config={config} settings={settings} onSettings={onSettings} actions={actions} />;

  return (
    <motion.div
      className="absolute inset-0 grid place-items-center bg-ink/40 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md border-2 border-ink bg-paper-light shadow-[6px_6px_0_0_var(--color-ink)]"
      >
        <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-2.5">
          <h2 id="panel-title" className="font-pixel text-sm uppercase tracking-widest">
            {TITLES[id]}
          </h2>
          <button ref={close} type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center border-2 border-ink bg-paper-light hover:bg-sun">
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto px-5 py-5 text-sm">{body}</div>
      </motion.section>
    </motion.div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="border-2 border-dashed border-ink/40 bg-sun/25 px-3 py-2 text-ink/80">{children}</p>;
}

function Desk({ config, status, onStatus }: { config: OfficeConfig; status: Status; onStatus: (s: Status) => void }) {
  const avatar = avatarById(config.avatarId);
  return (
    <>
      <div className="flex items-center gap-4">
        <div className="border-2 border-ink bg-sage/50 px-3 pt-2">
          <PixelSprite sprite={avatarWave(avatar)} label={`${avatar.name}, your avatar`} className="w-14" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{config.displayName}</p>
          <p className="text-muted">
            {avatar.name} · {config.workspaceName}
          </p>
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 font-semibold">Status</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <label
              key={s}
              className={`inline-flex cursor-pointer items-center gap-2 border-2 border-ink px-3 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-dashed has-[:focus-visible]:outline-forest ${
                status === s ? "bg-sun" : "bg-paper hover:bg-paper-deep"
              }`}
            >
              <input type="radio" name="status" className="sr-only" checked={status === s} onChange={() => onStatus(s)} />
              <span className={`size-2.5 ${STATUS_DOT[s]}`} aria-hidden />
              {STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <Note>
        Pick <strong>Focusing</strong> to sit down and work — move to get up again. You can also change your status any time
        from the top-left, without walking here. Your status is saved, and you can pick another desk from the Members panel.
      </Note>
    </>
  );
}

function Workspace({ config, seats, onOpen }: { config: OfficeConfig; seats: Seat[]; onOpen: (id: PanelId) => void }) {
  const rows: [string, string | undefined][] = [
    ["Name", config.workspaceName],
    ["About", config.workspaceDescription || undefined],
    ["Purpose", labelOf(PURPOSES, config.purpose)],
    ["Team size", labelOf(TEAM_SIZES, config.teamSize)],
    ["Style", labelOf(STYLES, config.workspaceStyle)],
    ["Template", labelOf(LAYOUTS, config.layout)],
    ["Office", tierOf(config.teamSize).label],
  ];
  return (
    <>
      <dl className="divide-y-2 divide-dashed divide-ink/15 border-2 border-ink bg-paper">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3 px-3 py-2">
              <dt className="font-mono text-xs uppercase tracking-wide text-muted">{k}</dt>
              <dd className="break-words font-medium">{v}</dd>
            </div>
          ))}
      </dl>
      <section aria-labelledby="seats-title">
        <h3 id="seats-title" className="mb-2 font-semibold">
          Who sits where
        </h3>
        <ol className="grid grid-cols-2 gap-1.5">
          {seats.map((s) => (
            <li key={s.desk} className="flex items-center gap-2 border-2 border-ink bg-paper px-2 py-1">
              <span className={`size-2.5 shrink-0 border border-ink ${SEAT_DOT[s.kind]}`} aria-hidden />
              <span className="font-mono text-xs text-muted">{s.desk}</span>
              <span className={`truncate ${s.kind === "open" ? "text-muted" : "font-medium"}`}>{seatLabel(s)}</span>
            </li>
          ))}
        </ol>
        {config.teammates.length > 0 && <p className="mt-1.5 text-xs text-muted">Invited teammates’ desks are saved until they join.</p>}
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onOpen("notices")} className="border-2 border-ink bg-paper px-3 py-2 font-semibold hover:bg-paper-deep">
          Read the notice board
        </button>
        <button type="button" onClick={() => onOpen("stats")} className="border-2 border-ink bg-paper px-3 py-2 font-semibold hover:bg-paper-deep">
          Office stats
        </button>
      </div>
      <Note>Every desk and plant is saved with your workspace, so the office looks the same each time you come back.</Note>
      <p className="font-pixel text-[0.6rem] uppercase tracking-widest text-terracotta">{officeBadge(config)}</p>
    </>
  );
}

function Meeting({ info }: { info?: MeetingInfo }) {
  return (
    <>
      <p className="text-base">
        {info?.room && /booth/i.test(info.room) ? "A quiet booth with a door that closes — good for a call." : "Six chairs, a big screen and a long table — a quiet place to think out loud."}
      </p>
      {info?.canCall ? (
        <>
          <p>
            {info.inCall.length ? (
              <>
                On the call in <strong>{info.room}</strong>: {info.inCall.join(", ")}.
              </>
            ) : (
              <>
                Nobody is on the call in <strong>{info.room}</strong> yet. Start it and teammates who walk in can join.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={info.onJoin}
            disabled={info.full}
            className="self-start border-2 border-ink bg-sun px-3 py-2 font-semibold hover:-translate-y-0.5 disabled:opacity-60"
          >
            {info.full ? "The call is full" : info.inCall.length ? "Join the video call" : "Start a video call"}
          </button>
          <Note>Your browser asks for your camera and microphone. Video goes straight between browsers when your network allows it, and through the office’s server when it doesn’t, so calls work anywhere. Nothing is recorded.</Note>
        </>
      ) : (
        <Note>Step inside the meeting room or a call booth to start a video call.</Note>
      )}
    </>
  );
}

function Break() {
  return (
    <>
      <div className="grid place-items-center py-2">
        <motion.div
          aria-hidden
          className="size-16 border-2 border-ink bg-sage"
          animate={{ scale: [1, 1.35, 1.35, 1] }}
          transition={{ duration: 8, times: [0, 0.4, 0.55, 1], repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <p className="text-center text-base">Breathe in as the square grows, out as it shrinks. Stay as long as you like.</p>
    </>
  );
}

function SettingsBody({
  config,
  settings,
  onSettings,
  actions,
}: {
  config: OfficeConfig;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  actions: OfficeActions;
}) {
  const { onPlan } = actions;
  const toggles: [keyof Settings, string, string][] = [
    ["sound", "Music", "Soft synthesised tunes, made in your browser."],
    ["minimap", "Minimap", "Whole-office overview in the corner."],
    ["nameTag", "Name tag", "Show your name above your avatar."],
  ];
  return (
    <>
      {config.role === "owner" ? (
        <PlanPicker
          layout={config.layout}
          style={config.workspaceStyle}
          teamSize={config.teamSize}
          onLayout={(layout) => onPlan(layout, config.teamSize)}
          onTeamSize={(teamSize) => onPlan(config.layout, teamSize)}
        />
      ) : (
        <Note>Only the workspace owner can change the floor plan, style and furniture.</Note>
      )}
      {config.role === "owner" && (
        <section aria-labelledby="arrange-title" className="flex flex-col gap-2">
          <h3 id="arrange-title" className="font-semibold">
            Move furniture
          </h3>
          <p className="text-muted">Pick pieces up and put them somewhere else. The new layout is saved for everyone.</p>
          <button type="button" onClick={actions.onArrange} className="self-start border-2 border-ink bg-sun px-3 py-2 font-semibold hover:-translate-y-0.5">
            Arrange furniture
          </button>
        </section>
      )}
      {config.role === "owner" && <LookForm key={`${config.workspaceStyle}|${config.features?.join()}`} config={config} onSave={actions.onLook} />}
      <ProfileForm key={`${config.displayName}|${config.avatarId}`} config={config} onSave={actions.onProfile} />
      <ul className="flex flex-col gap-2">
        {toggles.map(([key, label, hint]) => (
          <li key={key}>
            <label className="flex cursor-pointer items-center justify-between gap-4 border-2 border-ink bg-paper px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-dashed has-[:focus-visible]:outline-forest">
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="text-xs text-muted">{hint}</span>
              </span>
              <input type="checkbox" role="switch" className="sr-only" checked={settings[key]} onChange={(e) => onSettings({ [key]: e.target.checked })} />
              <span aria-hidden className={`relative h-5 w-9 shrink-0 border-2 border-ink ${settings[key] ? "bg-forest" : "bg-paper-deep"}`}>
                <span className={`absolute top-0.5 size-3 bg-paper-light ring-2 ring-ink transition-[left] ${settings[key] ? "left-[1.1rem]" : "left-0.5"}`} />
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3 pt-1">
        <Link href="/dashboard" className="border-2 border-ink bg-paper px-3 py-2 font-semibold hover:bg-paper-deep">
          All workspaces
        </Link>
        <Link href="/dashboard" className="border-2 border-ink bg-paper px-3 py-2 font-semibold hover:bg-paper-deep">
          Leave the office
        </Link>
      </div>
    </>
  );
}
