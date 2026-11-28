"use client";

import { motion } from "framer-motion";
import { BarChart3, Hand, MapPin, MessageSquare, Mic, MicOff, Move, Settings2, StickyNote, Users, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";
import { PixelImage, PixelSprite } from "@/components/pixel/PixelArt";
import { LOGO, PROP_PALETTE } from "@/components/pixel/props";
import { avatarById, avatarIdle } from "@/components/onboarding/avatars";
import type { OfficeConfig } from "./config";
import { MINIMAP } from "./game/camera";
import type { ArrangeState, GameEvents, PlayerStatus } from "./game/events";
import { TILE } from "./game/tiles";

export type Settings = { sound: boolean; minimap: boolean; nameTag: boolean };
export type Status = PlayerStatus;

export const STATUS_LABEL: Record<Status, string> = { available: "Available", focusing: "Focusing", break: "On a break" };
export const STATUS_DOT: Record<Status, string> = { available: "bg-[#6f9a5f]", focusing: "bg-terracotta", break: "bg-sun" };

const chip = "border-2 border-ink bg-paper-light/95 shadow-pixel-sm";

/** The viewer's role in this office. */
export function officeBadge(c: OfficeConfig) {
  return c.role === "owner" ? "Owner" : c.role === "admin" ? "Admin" : "Member";
}

export function Hud({
  config,
  mapSize,
  room,
  status,
  onStatus,
  settings,
  prompt,
  onInteract,
  onSound,
  onSettings,
  onMembers,
  onNotices,
  onStats,
  swapsWaiting = 0,
  live,
}: {
  config: OfficeConfig;
  /** Map size in tiles, for the minimap frame. */
  mapSize: { width: number; height: number };
  room: string;
  status: Status;
  onStatus: (s: Status) => void;
  settings: Settings;
  prompt: GameEvents["prompt"];
  onInteract: () => void;
  onSound: () => void;
  onSettings: () => void;
  onMembers: () => void;
  /** The notice board (shown when given). */
  onNotices?: () => void;
  /** Office stats (shown when given). */
  onStats?: () => void;
  /** Desk swap requests waiting for the viewer's answer, shown as a badge on the members button. */
  swapsWaiting?: number;
  /** The live office: who's here, chat and proximity voice (shown when given). */
  live?: LiveHud;
}) {
  const avatar = avatarById(config.avatarId);
  const mapW = Math.round(mapSize.width * TILE * MINIMAP.scale);
  const mapH = Math.round(mapSize.height * TILE * MINIMAP.scale);

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* Top-left: logo, workspace, room */}
      <div className="absolute left-3 top-3 flex flex-col items-start gap-2 sm:left-4 sm:top-4">
        <div className={`pointer-events-auto flex items-center gap-2.5 px-3 py-2 ${chip}`}>
          <Link href="/dashboard" aria-label="Back to dashboard" className="shrink-0">
            <PixelImage frame={LOGO} palette={PROP_PALETTE} className="h-6 w-6" />
          </Link>
          <div className="min-w-0">
            <p className="max-w-[14rem] truncate text-sm font-semibold leading-tight sm:max-w-xs">{config.workspaceName}</p>
            <p className="font-pixel text-[0.6rem] uppercase tracking-widest text-terracotta">{officeBadge(config)}</p>
          </div>
        </div>
        <StatusSwitch status={status} onStatus={onStatus} />
        {room && (
          <p className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-pixel text-[0.65rem] uppercase tracking-widest ${chip}`} aria-live="polite">
            <MapPin className="size-3.5 text-forest" aria-hidden />
            {room}
          </p>
        )}
        {live && (
          <button
            type="button"
            onClick={live.onPeople}
            title={live.online ? "Who’s in the office" : "Reconnecting to the live office…"}
            className={`pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold hover:bg-sun ${chip}`}
          >
            {live.online ? <Wifi className="size-3.5 text-forest" aria-hidden /> : <WifiOff className="size-3.5 text-terracotta" aria-hidden />}
            {live.online ? `${live.here} here` : "Offline"}
          </button>
        )}
      </div>

      {/* Top-right: player, sound, settings */}
      <div className="absolute right-3 top-3 flex items-center gap-2 sm:right-4 sm:top-4">
        <div className={`flex items-center gap-2 py-1 pl-1.5 pr-3 ${chip}`}>
          <span className="grid size-8 place-items-center overflow-hidden bg-sage/60">
            <PixelSprite sprite={avatarIdle(avatar)} className="w-5" />
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:block">{config.displayName}</span>
        </div>
        <button
          type="button"
          onClick={onSound}
          aria-pressed={settings.sound}
          aria-label={settings.sound ? "Mute music" : "Play music"}
          className={`pointer-events-auto grid size-10 place-items-center ${chip} hover:bg-sun`}
        >
          {settings.sound ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
        {live && (
          <button
            type="button"
            onClick={live.onVoice}
            aria-pressed={live.voiceOn}
            aria-label={live.voiceOn ? "Turn off proximity voice" : "Talk to people nearby"}
            title={
              live.voiceOn
                ? live.talkingWith.length
                  ? `Talking with ${live.talkingWith.join(", ")}`
                  : "Mic on — anyone standing near you can hear you"
                : "Mic off — you still hear people talking near you. Turn it on to talk back"
            }
            className={`pointer-events-auto relative grid size-10 place-items-center ${chip} ${live.voiceOn ? "bg-sage" : ""} hover:bg-sun`}
          >
            {live.voiceOn ? <Mic className="size-5" aria-hidden /> : <MicOff className="size-5" aria-hidden />}
            {live.voiceOn && live.talkingWith.length > 0 && <Badge>{live.talkingWith.length}</Badge>}
          </button>
        )}
        {live && (
          <button
            type="button"
            onClick={live.onChat}
            aria-label={live.unread ? `Chat, ${live.unread} unread` : "Chat"}
            title="Chat (Enter)"
            className={`pointer-events-auto relative grid size-10 place-items-center ${chip} hover:bg-sun`}
          >
            <MessageSquare className="size-5" aria-hidden />
            {live.unread > 0 && <Badge testId="chat-badge">{live.unread}</Badge>}
          </button>
        )}
        {onNotices && (
          <button type="button" onClick={onNotices} aria-label="Notice board" title="Notice board" className={`pointer-events-auto grid size-10 place-items-center ${chip} hover:bg-sun`}>
            <StickyNote className="size-5" aria-hidden />
          </button>
        )}
        {onStats && (
          <button type="button" onClick={onStats} aria-label="Office stats" title="Office stats" className={`pointer-events-auto grid size-10 place-items-center ${chip} hover:bg-sun`}>
            <BarChart3 className="size-5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onMembers}
          aria-label={swapsWaiting ? `Members, ${swapCount(swapsWaiting)} waiting` : "Members"}
          title={swapsWaiting ? `Members — ${swapCount(swapsWaiting)} waiting for you` : "Members"}
          className={`pointer-events-auto relative grid size-10 place-items-center ${chip} hover:bg-sun`}
        >
          <Users className="size-5" aria-hidden />
          {swapsWaiting > 0 && <Badge testId="swap-badge">{swapsWaiting}</Badge>}
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className={`pointer-events-auto grid size-10 place-items-center ${chip} hover:bg-sun`}
        >
          <Settings2 className="size-5" aria-hidden />
        </button>
      </div>

      {/* Bottom-left: controls */}
      <div className={`absolute bottom-3 left-3 hidden items-center gap-3 px-3 py-2 font-mono text-xs sm:bottom-4 sm:left-4 md:flex ${chip}`}>
        <span className="flex items-center gap-1">
          {["W", "A", "S", "D"].map((k) => (
            <Key key={k}>{k}</Key>
          ))}
          <span className="mx-1 text-muted">or</span>
          {["←", "↑", "↓", "→"].map((k) => (
            <Key key={k}>{k}</Key>
          ))}
          <span className="ml-1">move</span>
        </span>
        <span className="flex items-center gap-1">
          <Key>E</Key> interact
        </span>
        <span className="flex items-center gap-1">
          <Key>Esc</Key> close
        </span>
        {live && (
          <span className="flex items-center gap-1">
            <Key>Enter</Key> chat
          </span>
        )}
      </div>

      {/* Bottom-centre: pointer/touch-friendly interact button */}
      <div className="absolute inset-x-0 bottom-16 flex justify-center md:bottom-5" aria-live="polite">
        {prompt && (
          <button
            type="button"
            onClick={onInteract}
            className="pointer-events-auto inline-flex items-center gap-2 border-2 border-ink bg-sun px-4 py-2 text-sm font-semibold shadow-pixel transition-transform hover:-translate-y-0.5"
          >
            <Hand className="size-4" aria-hidden />
            {prompt.interaction.prompt}
            <Key>E</Key>
          </button>
        )}
      </div>

      {/* Bottom-right: minimap frame (the map itself is a Phaser camera) */}
      {settings.minimap && (
        <div
          aria-hidden
          className="absolute border-2 border-ink shadow-pixel-sm"
          style={{ right: MINIMAP.margin - 2, bottom: MINIMAP.margin - 2, width: mapW + 4, height: mapH + 4 }}
        />
      )}
    </div>
  );
}

/** What the HUD shows of the live office. */
export type LiveHud = {
  online: boolean;
  /** People in the office, you included. */
  here: number;
  unread: number;
  voiceOn: boolean;
  talkingWith: string[];
  onChat: () => void;
  onPeople: () => void;
  onVoice: () => void;
};

function Badge({ children, testId }: { children: number; testId?: string }) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center border-2 border-ink bg-terracotta px-0.5 font-pixel text-[0.55rem] leading-none text-ink"
    >
      {children > 9 ? "9+" : children}
    </span>
  );
}

const swapCount = (n: number) => `${n} desk swap request${n === 1 ? "" : "s"}`;

const STATUS_SHORT: Record<Status, string> = { available: "Available", focusing: "Focus", break: "Break" };
const STATUS_HINT: Record<Status, string> = {
  available: "Free to chat",
  focusing: "Sit at your desk and focus",
  break: "Taking a break",
};

/** Set your status from anywhere. Focus also sends you to your desk. */
function StatusSwitch({ status, onStatus }: { status: Status; onStatus: (s: Status) => void }) {
  return (
    <div role="radiogroup" aria-label="Your status" className={`pointer-events-auto flex p-0.5 ${chip}`}>
      {(Object.keys(STATUS_SHORT) as Status[]).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={status === s}
          title={STATUS_HINT[s]}
          onClick={() => onStatus(s)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold transition-colors ${
            status === s ? "bg-sun text-ink" : "text-ink/70 hover:bg-paper-deep hover:text-ink"
          }`}
        >
          <span className={`size-2 border border-ink ${STATUS_DOT[s]}`} aria-hidden />
          {STATUS_SHORT[s]}
        </button>
      ))}
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="inline-grid min-w-6 place-items-center border-2 border-ink bg-paper px-1 font-pixel text-[0.6rem] leading-4">{children}</kbd>;
}

/** Name tag and interaction bubble that follow the player. Moved by direct style writes, not React state. */
export function PlayerAnchor({
  ref,
  name,
  status,
  showName,
  prompt,
  bubble,
}: {
  ref: Ref<HTMLDivElement>;
  name: string;
  status: Status;
  showName: boolean;
  prompt: GameEvents["prompt"];
  /** Something you just said out loud. */
  bubble?: string;
}) {
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute left-0 top-0 will-change-transform">
      <div className="absolute bottom-1 left-0 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {bubble && !prompt && (
          <p className="max-w-[14rem] whitespace-normal break-words border-2 border-ink bg-paper-light px-2 py-1 text-center text-xs font-medium shadow-pixel-sm">{bubble}</p>
        )}
        {prompt && (
          <p className="whitespace-nowrap border-2 border-ink bg-paper-light px-2 py-1 font-pixel text-[0.65rem] uppercase tracking-wide shadow-pixel-sm">
            {prompt.interaction.prompt} — <span className="text-terracotta">Press E</span>
          </p>
        )}
        {showName && (
          <p className="flex items-center gap-1.5 whitespace-nowrap bg-ink/85 px-1.5 py-0.5 text-xs font-semibold text-paper">
            <span className={`size-2 ${STATUS_DOT[status]}`} />
            {name}
          </p>
        )}
      </div>
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-none absolute inset-x-0 top-20 mx-auto w-fit max-w-[90vw] border-2 border-ink bg-paper-light px-4 py-2.5 text-sm font-medium shadow-pixel"
    >
      {text}
    </motion.div>
  );
}

/**
 * Owner's bar while moving furniture: what to do, what's in hand, and
 * Cancel / Save. Replaces the normal HUD while arranging.
 */
export function ArrangeBar({
  state,
  saving,
  error,
  onCancel,
  onSave,
}: {
  state: ArrangeState;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  const hint = state.holding
    ? state.problem ?? `Click to put the ${state.holding} down here. Esc puts it back.`
    : "Click a piece of furniture to pick it up. Drag the floor or use WASD / arrow keys to look around.";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3 sm:top-4">
      <div role="region" aria-label="Arrange furniture" className={`pointer-events-auto flex w-full max-w-2xl flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center ${chip}`}>
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Move className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden />
          <div className="min-w-0">
            <p className="font-pixel text-[0.6rem] uppercase tracking-widest text-terracotta">
              Arranging · {state.moved} {state.moved === 1 ? "piece" : "pieces"} moved
            </p>
            <p className={`text-sm ${state.holding && state.problem ? "font-semibold text-terracotta" : ""}`} aria-live="polite">
              {error ?? hint}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="border-2 border-ink bg-paper px-3 py-1.5 text-sm font-semibold hover:bg-paper-deep disabled:opacity-60">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || state.moved === 0 || !!state.holding}
            title={state.holding ? "Put down what you're holding first" : undefined}
            className="border-2 border-ink bg-forest px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save layout"}
          </button>
        </div>
      </div>
    </div>
  );
}
