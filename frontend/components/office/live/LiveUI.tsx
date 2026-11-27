"use client";

import { motion } from "framer-motion";
import { Mic, MicOff, PhoneOff, Send, Video, VideoOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PixelSprite } from "@/components/pixel/PixelArt";
import { avatarById, avatarIdle } from "@/components/onboarding/avatars";
import { ApiError } from "@/lib/api";
import type { GameBus } from "../game/events";
import { STATUS_DOT, STATUS_LABEL } from "../hud";
import type { LiveClient, LiveState } from "./client";
import { OFFICE_CHANNEL, getMessages, sendMessage } from "./chatService";
import { MESSAGE_MAX, SAY_MAX, type ChatMessage, type PeerView } from "./protocol";
import type { FrameStore } from "./media";
import type { Bubble, NearbyLine } from "./useLive";

/* --------------------------------- Name tags -------------------------------- */

/**
 * Name tags (with status, mic and speech bubbles) over teammates' avatars.
 * The game reports their positions every frame; they're written straight to
 * the DOM, like the player's own tag.
 */
export function PeerTags({
  bus,
  peers,
  bubbles,
  showNames,
  talkingWith,
}: {
  bus: GameBus;
  peers: PeerView[];
  bubbles: Record<string, Bubble>;
  showNames: boolean;
  talkingWith: string[];
}) {
  const els = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    bus.onPeerAnchor = (id, x, y) => {
      const el = els.current.get(id);
      if (el) el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    return () => {
      bus.onPeerAnchor = null;
    };
  }, [bus]);

  return (
    <>
      {peers.map((p) => {
        const bubble = bubbles[p.id];
        return (
          <div
            key={p.id}
            ref={(el) => {
              if (el) els.current.set(p.id, el);
              else els.current.delete(p.id);
            }}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 will-change-transform"
            // Off-screen until the game places it on the next frame.
            style={{ transform: "translate(-999px, -999px)" }}
          >
            <div className="absolute bottom-1 left-0 flex -translate-x-1/2 flex-col items-center gap-1.5">
              {bubble && <SpeechBubble text={bubble.text} />}
              {showNames && (
                <p className="flex items-center gap-1.5 whitespace-nowrap bg-ink/75 px-1.5 py-0.5 text-xs font-semibold text-paper">
                  <span className={`size-2 ${STATUS_DOT[p.status]}`} />
                  {p.name}
                  {p.voice && <Mic className={`size-3 ${talkingWith.includes(p.id) ? "text-sun" : "text-paper/60"}`} />}
                  {p.call && <Video className="size-3 text-sage" />}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function SpeechBubble({ text }: { text: string }) {
  return (
    <p className="max-w-[14rem] whitespace-normal break-words border-2 border-ink bg-paper-light px-2 py-1 text-center text-xs font-medium shadow-pixel-sm">{text}</p>
  );
}

/* ----------------------------------- Chat ----------------------------------- */

export type ChatTab = "office" | "room" | "nearby" | "people";

const time = (iso: string | number) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The chat drawer: the whole office's channel, the channel of the room you're
 * standing in, what people nearby said out loud, and who is in the office.
 */
export function ChatDrawer({
  workspaceId,
  live,
  liveState,
  room,
  peers,
  nearby,
  myName,
  myStatus,
  initialTab = "office",
  onSay,
  onFocusChange,
  onClose,
}: {
  workspaceId: string;
  live: LiveClient | null;
  liveState: LiveState;
  room: string;
  peers: PeerView[];
  nearby: NearbyLine[];
  myName: string;
  myStatus: PeerView["status"];
  initialTab?: ChatTab;
  onSay: (text: string) => void;
  /** Typing pauses the avatar so WASD types letters instead of walking. */
  onFocusChange: (focused: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ChatTab>(initialTab);
  const channel = tab === "room" && room ? room : OFFICE_CHANNEL;
  const isChannel = tab === "office" || tab === "room";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  useEffect(() => input.current?.focus(), [tab]);
  useEffect(() => () => onFocusChange(false), [onFocusChange]);

  // History for the open channel.
  useEffect(() => {
    if (!isChannel) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setMessages([]);
    getMessages(workspaceId, channel)
      .then((r) => {
        if (!alive) return;
        stick.current = true;
        setMessages(r.messages);
        setMore(r.more);
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Couldn’t load the messages."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [workspaceId, channel, isChannel]);

  // New messages arrive over the live socket.
  useEffect(() => {
    if (!live || !isChannel) return;
    return live.on((msg) => {
      if (msg.t !== "chat" || msg.message.channel !== channel) return;
      setMessages((m) => (m.some((x) => x.messageId === msg.message.messageId) ? m : [...m, msg.message]));
    });
  }, [live, channel, isChannel]);

  // Stay at the bottom unless the reader scrolled up.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, nearby, tab]);

  const older = async () => {
    const first = messages[0];
    if (!first) return;
    try {
      const r = await getMessages(workspaceId, channel, first.createdAt);
      stick.current = false;
      setMessages((m) => [...r.messages, ...m]);
      setMore(r.more);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t load older messages.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    if (tab === "nearby") {
      onSay(text.slice(0, SAY_MAX));
      setDraft("");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { message } = await sendMessage(workspaceId, channel, text);
      stick.current = true;
      setMessages((m) => (m.some((x) => x.messageId === message.messageId) ? m : [...m, message]));
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t send that. Try again.");
    } finally {
      setSending(false);
    }
  };

  const tabs: [ChatTab, string][] = [
    ["office", "Office"],
    ["room", room || "Room"],
    ["nearby", "Nearby"],
    ["people", `People · ${peers.length + 1}`],
  ];
  const max = tab === "nearby" ? SAY_MAX : MESSAGE_MAX;

  return (
    <motion.aside
      role="dialog"
      aria-label="Chat"
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 16, opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="pointer-events-auto absolute inset-x-3 bottom-3 top-auto flex h-[60dvh] flex-col border-2 border-ink bg-paper-light shadow-pixel sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20 sm:h-[min(34rem,calc(100dvh-7rem))] sm:w-[22rem]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-3 py-2">
        <h2 className="flex items-center gap-2 font-pixel text-xs uppercase tracking-widest">
          Chat
          <span className={`size-2 border border-ink ${liveState === "online" ? "bg-[#6f9a5f]" : "bg-paper-deep"}`} title={liveState === "online" ? "Live" : "Reconnecting…"} />
        </h2>
        <button type="button" onClick={onClose} aria-label="Close chat" className="grid size-7 place-items-center border-2 border-ink bg-paper-light hover:bg-sun">
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div role="tablist" aria-label="Chat channels" className="flex border-b-2 border-ink bg-paper text-xs font-semibold">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            disabled={id === "room" && !room}
            onClick={() => setTab(id)}
            className={`min-w-0 flex-1 truncate border-r-2 border-ink px-2 py-1.5 last:border-r-0 disabled:opacity-50 ${tab === id ? "bg-sun" : "hover:bg-paper-deep"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <People peers={peers} myName={myName} myStatus={myStatus} room={room} />
      ) : (
        <ol
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 text-sm"
          aria-live="polite"
        >
          {tab === "nearby" ? (
            nearby.length ? (
              nearby.map((l, i) => (
                <li key={`${l.at}-${i}`}>
                  <span className={`font-semibold ${l.you ? "text-forest" : ""}`}>{l.name}</span> <span className="text-xs text-muted">{time(l.at)}</span>
                  <p className="break-words">{l.text}</p>
                </li>
              ))
            ) : (
              <li className="text-muted">Say something out loud — only people standing near you hear it, and it isn’t saved.</li>
            )
          ) : (
            <>
              {more && (
                <li>
                  <button type="button" onClick={older} className="w-full border-2 border-dashed border-ink/40 px-2 py-1 text-xs hover:bg-paper-deep">
                    Load older messages
                  </button>
                </li>
              )}
              {loading && <li className="text-muted">Loading…</li>}
              {!loading && !messages.length && !error && (
                <li className="text-muted">{tab === "room" ? `Nothing in ${room} yet. Messages here are for this room.` : "No messages yet. Say hi to the office!"}</li>
              )}
              {messages.map((m) => (
                <li key={m.messageId} className="flex gap-2">
                  <span className="grid size-7 shrink-0 place-items-center overflow-hidden border border-ink bg-sage/60">
                    <PixelSprite sprite={avatarIdle(avatarById(m.authorAvatar))} className="w-4" />
                  </span>
                  <div className="min-w-0">
                    <p>
                      <span className="font-semibold">{m.authorName}</span> <span className="text-xs text-muted">{time(m.createdAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                </li>
              ))}
            </>
          )}
        </ol>
      )}

      {tab !== "people" && (
        <form onSubmit={submit} className="flex flex-col gap-1 border-t-2 border-ink bg-paper px-2 py-2">
          {error && (
            <p role="alert" className="text-xs font-semibold text-terracotta">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="chat-input">
              {tab === "nearby" ? "Say something to people nearby" : `Message ${channel === OFFICE_CHANNEL ? "the office" : channel}`}
            </label>
            <input
              id="chat-input"
              ref={input}
              value={draft}
              maxLength={max}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => onFocusChange(true)}
              onBlur={() => onFocusChange(false)}
              placeholder={tab === "nearby" ? "Say something nearby…" : channel === OFFICE_CHANNEL ? "Message the office…" : `Message ${channel}…`}
              className="min-w-0 flex-1 border-2 border-ink bg-paper-light px-2 py-1.5 text-sm"
              autoComplete="off"
            />
            <button type="submit" disabled={!draft.trim() || sending} aria-label="Send" className="grid size-9 place-items-center border-2 border-ink bg-sun disabled:opacity-60">
              <Send className="size-4" aria-hidden />
            </button>
          </div>
        </form>
      )}
    </motion.aside>
  );
}

function People({ peers, myName, myStatus, room }: { peers: PeerView[]; myName: string; myStatus: PeerView["status"]; room: string }) {
  const sorted = useMemo(() => [...peers].sort((a, b) => a.name.localeCompare(b.name)), [peers]);
  const row = (key: string, name: string, status: PeerView["status"], where: string, extra?: string) => (
    <li key={key} className="flex items-center gap-2 border-2 border-ink bg-paper px-2 py-1.5">
      <span className={`size-2.5 shrink-0 border border-ink ${STATUS_DOT[status]}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{name}</span>
        <span className="block truncate text-xs text-muted">
          {STATUS_LABEL[status]}
          {where ? ` · ${where}` : ""}
          {extra ? ` · ${extra}` : ""}
        </span>
      </span>
    </li>
  );
  return (
    <ul className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3 text-sm">
      {row("you", `${myName} (you)`, myStatus, room)}
      {sorted.map((p) => row(p.id, p.name, p.status, p.room, p.call ? "in a call" : p.voice ? "mic on" : undefined))}
      {!peers.length && <li className="pt-1 text-muted">Nobody else is in the office right now.</li>}
    </ul>
  );
}

/* ----------------------------------- Calls ---------------------------------- */

function Tile({ name, talking, children, showInitial }: { name: string; talking?: boolean; children?: ReactNode; showInitial: boolean }) {
  return (
    <figure className={`relative aspect-video overflow-hidden border-2 bg-forest-deep ${talking ? "border-sun ring-2 ring-sun" : "border-ink"}`}>
      {children}
      {showInitial && <span className="absolute inset-0 grid place-items-center font-pixel text-2xl uppercase text-paper/80">{name.slice(0, 1)}</span>}
      <figcaption className="absolute bottom-1 left-1 flex items-center gap-1 bg-ink/80 px-1.5 py-0.5 text-xs font-semibold text-paper">
        {talking && <Mic className="size-3 text-sun" aria-hidden />}
        {name}
      </figcaption>
    </figure>
  );
}

/** Your own camera, straight from the device. */
function LocalTile({ stream, name }: { stream: MediaStream | null; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream]);
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState === "live");
  return (
    <Tile name={name} showInitial={!hasVideo}>
      <video ref={ref} autoPlay playsInline muted className={`size-full -scale-x-100 object-cover ${hasVideo ? "" : "invisible"}`} />
    </Tile>
  );
}

/** A teammate's camera over a direct link: real video, and their sound plays from this element. */
function DirectTile({ stream, name, talking }: { stream: MediaStream; name: string; talking: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  const hasVideo = stream.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
  return (
    <Tile name={name} talking={talking} showInitial={!hasVideo}>
      <video ref={ref} autoPlay playsInline className={`size-full object-cover ${hasVideo ? "" : "invisible"}`} />
    </Tile>
  );
}

/** A teammate's camera through the relay: the latest snapshot (no picture for 3 s shows their initial). */
function RemoteTile({ id, name, frames, talking }: { id: string; name: string; frames: FrameStore; talking: boolean }) {
  const img = useRef<HTMLImageElement>(null);
  const [showing, setShowing] = useState(() => !!frames.latest(id));
  useEffect(() => {
    let last = frames.latest(id)?.at ?? 0;
    if (img.current && frames.latest(id)) img.current.src = frames.latest(id)!.url;
    const off = frames.subscribe(id, (url) => {
      if (url && img.current) img.current.src = url;
      last = url ? Date.now() : 0;
      setShowing(!!url);
    });
    const t = setInterval(() => setShowing(Date.now() - last < 3000), 1000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [id, frames]);
  return (
    <Tile name={name} talking={talking} showInitial={!showing}>
      {/* eslint-disable-next-line @next/next/no-img-element -- live camera snapshots (blob: URLs) */}
      <img ref={img} alt="" className={`size-full object-cover ${showing ? "" : "invisible"}`} />
    </Tile>
  );
}

/** A room's video call: everyone's camera, your own preview, and mute / camera / leave. */
export function CallView({
  room,
  local,
  frames,
  streams,
  talking,
  peers,
  myName,
  muted,
  cameraOff,
  hasVideo,
  onMute,
  onCamera,
  onLeave,
}: {
  room: string;
  local: MediaStream | null;
  frames: FrameStore;
  /** Direct (WebRTC) streams by member id; everyone else comes through the relay. */
  streams: Map<string, MediaStream>;
  /** Member ids heard in the last moment. */
  talking: Set<string>;
  peers: PeerView[];
  myName: string;
  muted: boolean;
  cameraOff: boolean;
  hasVideo: boolean;
  onMute: () => void;
  onCamera: () => void;
  onLeave: () => void;
}) {
  const leave = useRef<HTMLButtonElement>(null);
  useEffect(() => leave.current?.focus(), []);
  const inCall = peers.filter((p) => p.call === room);
  const count = inCall.length + 1;
  const cols = count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <motion.div
      className="absolute inset-0 grid place-items-center bg-ink/60 p-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onKeyDown={(e) => e.key === "Escape" && onLeave()}
    >
      <section role="dialog" aria-modal="true" aria-label={`Video call in ${room}`} className="flex max-h-full w-full max-w-4xl flex-col border-2 border-ink bg-paper-light shadow-[6px_6px_0_0_var(--color-ink)]">
        <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-2.5">
          <h2 className="font-pixel text-sm uppercase tracking-widest">
            {room} · {count} {count === 1 ? "person" : "people"}
          </h2>
        </header>
        <div className={`grid gap-2 overflow-y-auto p-3 ${cols}`}>
          <LocalTile stream={cameraOff ? null : local} name={`${myName} (you)`} />
          {inCall.map((p) => {
            const stream = streams.get(p.id);
            return stream ? (
              <DirectTile key={p.id} stream={stream} name={p.name} talking={talking.has(p.id)} />
            ) : (
              <RemoteTile key={p.id} id={p.id} name={p.name} frames={frames} talking={talking.has(p.id)} />
            );
          })}
        </div>
        {count === 1 && <p className="px-4 pb-1 text-sm text-muted">You’re the first one here. Teammates who walk in and join will appear here.</p>}
        <footer className="flex justify-center gap-2 border-t-2 border-ink bg-paper px-4 py-2.5">
          <button type="button" onClick={onMute} aria-pressed={muted} className={`flex items-center gap-1.5 border-2 border-ink px-3 py-1.5 text-sm font-semibold ${muted ? "bg-terracotta" : "bg-paper-light hover:bg-sun"}`}>
            {muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
            {muted ? "Unmute" : "Mute"}
          </button>
          {hasVideo && (
            <button type="button" onClick={onCamera} aria-pressed={cameraOff} className={`flex items-center gap-1.5 border-2 border-ink px-3 py-1.5 text-sm font-semibold ${cameraOff ? "bg-terracotta" : "bg-paper-light hover:bg-sun"}`}>
              {cameraOff ? <VideoOff className="size-4" aria-hidden /> : <Video className="size-4" aria-hidden />}
              {cameraOff ? "Camera on" : "Camera off"}
            </button>
          )}
          <button ref={leave} type="button" onClick={onLeave} className="flex items-center gap-1.5 border-2 border-ink bg-ink px-3 py-1.5 text-sm font-semibold text-paper hover:bg-forest-deep">
            <PhoneOff className="size-4" aria-hidden />
            Leave call
          </button>
        </footer>
      </section>
    </motion.div>
  );
}
