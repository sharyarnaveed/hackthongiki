"use client";

import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MotionProvider } from "@/components/motion/Motion";
import { OfficeAudio } from "./audio";
import { createGame } from "./game/createGame";
import { GameBus, type ArrangeState, type GameEvents } from "./game/events";
import { seatFor } from "./game/seating";
import { ArrangeBar, Hud, PlayerAnchor, Toast, type Settings, type Status } from "./hud";
import { OfficePanel, type OfficeActions, type PanelId } from "./panels";
import type { LayoutId } from "@/components/onboarding/model";
import { NoWorkspaceError, prepareOffice, resetPreparedOffice, type PreparedOffice } from "./prepare";
import { changeOffice, savePosition, savePreferences, saveStatus, type OfficeChange } from "./service";
import { saveProfile, takeDesk } from "@/components/team/service";
import { ApiError } from "@/lib/api";
import { LoadingCard } from "./LoadingScreen";
import { useSwapRequests } from "./useSwapRequests";
import { countStat, ordinal, saveLayout } from "./lifeService";
import { CallView, ChatDrawer, PeerTags, type ChatTab } from "./live/LiveUI";
import { CALL_MAX } from "./live/protocol";
import { createMedia, useCall, useLive, useVoice } from "./live/useLive";

/** Actions the office page itself provides; the World adds the ones that need its own state. */
type PageActions = Omit<OfficeActions, "onArrange" | "onOpen">;

/**
 * The `/office` surface: a full-screen Phaser world with a light React HUD on
 * top. Game state lives in Phaser; React only hears about prompt, room and
 * interaction changes through the bus, never per-frame movement.
 */
export function OfficeApp() {
  const [prepared, setPrepared] = useState<PreparedOffice | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let live = true;
    prepareOffice()
      .then((p) => live && setPrepared(p))
      .catch((err) => {
        if (!live) return;
        // No workspace yet: set one up instead of showing an empty office.
        if (err instanceof NoWorkspaceError) return router.replace("/onboarding");
        setError(true);
      });
    return () => {
      live = false;
    };
  }, [attempt, router]);

  const config = prepared?.config;
  /** Saves the avatar's spot right now; set by the World while the game runs. */
  const flushPosition = useRef<() => Promise<void>>(async () => {});

  /** Fetch the office again (the old one stays on screen until the new one is ready). */
  const reload = useCallback(async (keepSpot: boolean) => {
    if (keepSpot) await flushPosition.current();
    resetPreparedOffice();
    setAttempt((n) => n + 1);
  }, []);

  /** Owner: the server regenerates the office and saves it for everyone. Throws so forms can show the error. */
  const rebuild = useCallback(
    async (change: OfficeChange) => {
      if (!config?.workspaceId || config.role !== "owner") return;
      await changeOffice(config.workspaceId, change);
      await reload(false);
    },
    [config, reload],
  );

  const actions = useMemo<PageActions>(
    () => ({
      onPlan: (officeLayout: LayoutId, teamSize: string) =>
        rebuild({ officeLayout, teamSize }).catch((err) => {
          console.error("[office] couldn't save the new plan", err);
          setError(true);
          setPrepared(null);
        }),
      onLook: (change) => rebuild(change),
      onProfile: async (patch) => {
        if (!config?.workspaceId) return;
        await saveProfile(config.workspaceId, patch);
        await reload(true);
      },
      // Desks, roles, members and invitations all show up in the office: load it again.
      onTeam: (what) => {
        // Invite codes and swap requests don't change the office itself.
        if (what !== "invite" && what !== "swap-requests") reload(true);
      },
    }),
    [config, rebuild, reload],
  );

  if (!prepared) {
    return (
      <main className="grid min-h-dvh place-items-center bg-forest-deep p-4 font-display">
        <LoadingCard
          title={error ? "The office couldn’t open" : "Opening the office…"}
          error={error}
          onRetry={() => {
            setError(false);
            setAttempt((n) => n + 1);
          }}
        />
      </main>
    );
  }
  return (
    <MotionProvider>
      <World prepared={prepared} actions={actions} reload={reload} flushRef={flushPosition} />
    </MotionProvider>
  );
}

function World({
  prepared,
  actions,
  reload,
  flushRef,
}: {
  prepared: PreparedOffice;
  actions: PageActions;
  reload: (keepSpot: boolean) => Promise<void>;
  flushRef: MutableRefObject<() => Promise<void>>;
}) {
  const { config } = prepared;
  const seats = useMemo(
    () =>
      prepared.map.objects
        .flatMap((o) => (o.desk === undefined ? [] : [o.desk]))
        .sort((a, b) => a - b)
        .map((d) => seatFor(config, d)),
    [prepared, config],
  );
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [bus] = useState(() => new GameBus());
  const [audio] = useState(() => new OfficeAudio());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [prompt, setPrompt] = useState<GameEvents["prompt"]>(null);
  const [room, setRoom] = useState("");
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  // Saved workspaces start from the status and settings stored on the server.
  // "On a break" isn't resumed: you're no longer on the sofa after a reload.
  const [status, setStatus] = useState<Status>(config.status === "focusing" ? "focusing" : "available");
  const statusRef = useRef(status);
  const savedPrefs = config.preferences;
  // Music can only start after a click or key press, so it begins off and resumes on the first gesture.
  const [settings, setSettings] = useState<Settings>({ sound: false, minimap: savedPrefs?.minimap ?? true, nameTag: savedPrefs?.nameTag ?? true });
  const soundOn = useRef(false);
  const workspaceId = config.workspaceId;
  // Owner's arrange mode: null when not arranging.
  const [arrange, setArrange] = useState<ArrangeState | null>(null);
  const [arrangeSaving, setArrangeSaving] = useState(false);
  const [arrangeError, setArrangeError] = useState<string | null>(null);
  // Live office: the chat drawer (and which tab), whether you're typing in it, unread messages.
  const [chat, setChat] = useState<ChatTab | null>(null);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(0);

  /** Save changed settings to the account. */
  const persistPrefs = useCallback((patch: Partial<Settings>) => {
    savePreferences(patch).catch((err) => console.error("[office] couldn't save settings", err));
  }, []);

  const say = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  // Teammates walking around, chat, proximity voice and video calls.
  const liveHandlers = useMemo(
    () => ({
      onOfficeChanged: (by: string) => {
        say(`${by} changed the office — loading the new layout.`);
        reload(true);
      },
      onError: say,
    }),
    [say, reload],
  );
  const { live, state: liveState, peers, bubbles, nearby, say: sayNearby } = useLive(workspaceId, bus, ready, liveHandlers);
  const [media] = useState(createMedia);
  useEffect(() => () => media.player.close(), [media]);
  const call = useCall(live, peers, media, say);
  const voice = useVoice(live, bus, media, call.room, say);
  // Who's talking in the call, for the tile highlight.
  const [callTalking, setCallTalking] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!call.room) return setCallTalking(new Set());
    const t = setInterval(() => {
      const now = performance.now();
      setCallTalking(new Set([...media.player.heard].filter(([, at]) => now - at < 600).map(([id]) => id)));
    }, 300);
    return () => clearInterval(t);
  }, [call.room, media]);
  const chatOpen = chat !== null;
  const names = useMemo(() => new Map(peers.map((p) => [p.id, p.name])), [peers]);

  // Count messages from others while the chat is closed.
  useEffect(() => {
    if (!live || chatOpen) return;
    return live.on((msg) => {
      if (msg.t === "chat" && msg.message.authorId !== live.me) setUnread((n) => n + 1);
    });
  }, [live, chatOpen]);
  useEffect(() => {
    if (chatOpen) setUnread(0);
  }, [chatOpen]);

  const setSound = useCallback(
    (on: boolean) => {
      // Called from clicks and key presses only, so audio always starts on a user gesture.
      soundOn.current = on;
      if (on) audio.start();
      else audio.stop();
      setSettings((s) => ({ ...s, sound: on }));
    },
    [audio],
  );

  const toggleSound = useCallback(
    (on: boolean) => {
      setSound(on);
      persistPrefs({ sound: on });
    },
    [setSound, persistPrefs],
  );

  // Saved "music on": start it with the first click or key press (browsers block autoplay).
  useEffect(() => {
    if (!savedPrefs?.sound) return;
    const resume = () => {
      if (!soundOn.current) setSound(true);
      off();
    };
    const off = () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return off;
  }, [savedPrefs?.sound, setSound]);

  // Remember where the avatar stands: every 15 s if it moved, when the tab is hidden or closed, and
  // before the office reloads. Declared before the game effect so its cleanup runs while the game still exists.
  useEffect(() => {
    if (!workspaceId || !ready) return;
    const officeSavedAt = config.officeSavedAt;
    let last = config.position ?? null;
    let seen: { x: number; y: number } | null = null;
    const save = (keepalive = false) => {
      const p = bus.positionOf?.() ?? seen;
      if (!p || (last && Math.hypot(p.x - last.x, p.y - last.y) < 8)) return Promise.resolve();
      last = p;
      return savePosition(workspaceId, p, officeSavedAt, keepalive).then(() => {});
    };
    const sample = setInterval(() => (seen = bus.positionOf?.() ?? seen), 2000);
    const timer = setInterval(() => save(), 15000);
    const onHidden = () => document.visibilityState === "hidden" && save(true);
    const onLeave = () => save(true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeave);
    flushRef.current = () => save();
    return () => {
      clearInterval(sample);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeave);
      flushRef.current = async () => {};
      save(true);
    };
  }, [ready, workspaceId, bus, config, flushRef]);

  // Mount exactly one Phaser game for this component; tear it down on unmount.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let game: ReturnType<typeof createGame> | undefined;
    // Start on the next frame so the host has its final size.
    const frame = requestAnimationFrame(() => {
      try {
        game = createGame(el, prepared, bus);
      } catch {
        setFailed(true);
      }
    });
    bus.setAnchor((x, y) => {
      if (anchor.current) anchor.current.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
    const off = [
      bus.on("ready", () => setReady(true)),
      bus.on("prompt", setPrompt),
      bus.on("room", setRoom),
      bus.on("arrange", (state) => {
        setArrange((a) => (a ? state : a));
        setArrangeError(null);
      }),
    ];
    return () => {
      cancelAnimationFrame(frame);
      off.forEach((fn) => fn());
      bus.setAnchor(null);
      game?.destroy(true);
      // A new map is starting: forget the old one's prompt and room.
      setReady(false);
      setPrompt(null);
      setRoom("");
      setArrange(null);
      setArrangeSaving(false);
    };
  }, [prepared, bus]);

  useEffect(() => () => audio.dispose(), [audio]);

  // With `cacheComponents`, Next keeps this page's state when you go to the dashboard and come back.
  // Close panels and toasts when the office is hidden, so it reopens clean instead of on Settings.
  useEffect(
    () => () => {
      setPanel(null);
      setToast(null);
      // The audio was disposed above; show music as off until it's turned on again.
      soundOn.current = false;
      setSettings((s) => ({ ...s, sound: false }));
    },
    [],
  );

  // Swap requests waiting for you: a badge on the members button, and a toast when a new one arrives.
  const { waiting: swapsWaiting, refresh: refreshSwaps } = useSwapRequests(workspaceId, (fresh) =>
    say(
      fresh.length === 1
        ? `${fresh[0].from.displayName} asked to swap desks with you. Open Members to answer.`
        : `${fresh.length} desk swap requests are waiting. Open Members to answer.`,
    ),
  );
  // Answering in the members panel changes the list: check again once it closes.
  const wasMembers = useRef(false);
  useEffect(() => {
    if (wasMembers.current && panel !== "members") refreshSwaps();
    wasMembers.current = panel === "members";
  }, [panel, refreshSwaps]);

  /** Count a coffee or cat pet on the server and say so with the office's new total. */
  const count = useCallback(
    (action: "coffee" | "cat", line: (officeTotal: number) => string, fallback: string) => {
      if (!workspaceId) return say(fallback);
      countStat(workspaceId, action)
        .then((r) => say(r.counted ? line(action === "coffee" ? r.office.coffees : r.office.catPets) : fallback))
        .catch(() => say(fallback));
    },
    [workspaceId, say],
  );

  /** Owner: start moving furniture. */
  const startArrange = useCallback(() => {
    setPanel(null);
    setArrangeError(null);
    setArrange({ moved: 0, holding: null, problem: null });
    bus.emit("set-arrange", true);
  }, [bus]);

  const cancelArrange = useCallback(() => {
    bus.emit("set-arrange", false);
    setArrange(null);
    setArrangeError(null);
  }, [bus]);

  /** Save the moved furniture for everyone, then load the office again with it. */
  const saveArrange = useCallback(async () => {
    const moves = bus.arrangeMoves?.() ?? [];
    if (!workspaceId || !moves.length) return cancelArrange();
    setArrangeSaving(true);
    setArrangeError(null);
    try {
      await saveLayout(workspaceId, moves, config.officeSavedAt);
      bus.emit("arrange-saved");
      say(`Layout saved — ${moves.length === 1 ? "1 move" : `${moves.length} moves`}. Everyone sees the new arrangement.`);
      await reload(true);
    } catch (err) {
      setArrangeError(err instanceof ApiError ? err.message : "Couldn’t save the layout. Try again.");
      setArrangeSaving(false);
    }
  }, [bus, workspaceId, config.officeSavedAt, cancelArrange, say, reload]);

  const panelActions = useMemo<OfficeActions>(() => ({ ...actions, onArrange: startArrange, onOpen: setPanel }), [actions, startArrange]);

  // Interactions coming from the world.
  useEffect(
    () =>
      bus.on("interact", ({ interaction }) => {
        if (soundOn.current) audio.chime();
        switch (interaction.action) {
          case "desk":
            return setPanel("desk");
          case "workspace":
            return setPanel("workspace");
          case "meeting":
            return setPanel("meeting");
          case "break":
            // First press sits you down; pressing again while seated opens the breathing exercise.
            if (statusRef.current === "break") return setPanel("break");
            setStatus("break");
            return say("Taking a break. Press E for a breathing exercise, or move to get up.");
          case "coffee":
            return count("coffee", (n) => `Fresh coffee brewed — the office’s ${ordinal(n)} cup. Enjoy a little break.`, "Fresh coffee brewed. Enjoy a little break.");
          case "cat":
            return count("cat", (n) => `Purrr. The office cat has been petted ${n} ${n === 1 ? "time" : "times"} and approves of your work today.`, interaction.flavor ?? "Purrr.");
          case "notices":
            return setPanel("notices");
          case "music": {
            const on = !soundOn.current;
            toggleSound(on);
            return say(on ? "Record on — soft tunes playing." : "Record off. Nice and quiet.");
          }
          case "flavor":
            return say(interaction.flavor ?? "");
          case "claim-desk": {
            const desk = interaction.desk;
            if (!workspaceId || !desk) return;
            return takeDesk(workspaceId, desk)
              .then(() => {
                say(`Desk ${desk} is yours now.`);
                reload(true);
              })
              .catch((err) => say(err instanceof ApiError ? err.message : "Couldn’t take that desk. Try again."));
          }
        }
      }),
    [bus, audio, say, toggleSound, workspaceId, reload, count],
  );

  // Status: the game sits you at your desk for Focus and gets you up for Available.
  useEffect(() => {
    statusRef.current = status;
    if (ready) bus.emit("set-status", status);
  }, [status, ready, bus]);

  // Save every status change for saved workspaces (the server ignores repeats).
  const lastSaved = useRef(config.status ?? "available");
  useEffect(() => {
    if (!workspaceId || lastSaved.current === status) return;
    lastSaved.current = status;
    saveStatus(workspaceId, status).catch((err) => console.error("[office] couldn't save status", err));
  }, [status, workspaceId]);

  useEffect(
    () =>
      bus.on("stood", () => {
        if (statusRef.current === "available") return;
        setStatus("available");
        say("Back on your feet — status set to Available.");
      }),
    [bus, say],
  );

  const changeStatus = useCallback(
    (s: Status) => {
      setStatus(s);
      if (s === "focusing") {
        setPanel(null);
        say("Focus mode on — you’re at your desk. Move to get up.");
      }
    },
    [say],
  );

  // Panels, typing in the chat and video calls pause movement (re-sent when a new map is ready).
  useEffect(() => {
    bus.emit("set-paused", panel !== null || typing || call.room !== null);
  }, [panel, typing, call.room, bus, ready]);

  // Enter opens the chat (when nothing else is open).
  useEffect(() => {
    if (panel || chatOpen || arrange || call.room) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || (e.target as HTMLElement)?.closest?.("input, textarea, button, select, a")) return;
      e.preventDefault();
      setChat("office");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, chatOpen, arrange, call.room]);

  // Escape closes panels.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  useEffect(() => {
    if (ready) bus.emit("set-minimap", settings.minimap);
  }, [ready, settings.minimap, bus]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#2b2a22] font-display text-ink">
      <div ref={host} className="absolute inset-0 [&_canvas]:block" aria-label={`${config.workspaceName}, an explorable pixel office`} role="application" />
      <PeerTags bus={bus} peers={peers} bubbles={bubbles} showNames={settings.nameTag} talkingWith={voice.talkingWith} />
      <PlayerAnchor
        ref={anchor}
        name={config.displayName}
        status={status}
        showName={settings.nameTag}
        prompt={panel || arrange ? null : prompt}
        bubble={live?.me ? bubbles[live.me]?.text : undefined}
      />
      {arrange ? (
        <ArrangeBar state={arrange} saving={arrangeSaving} error={arrangeError} onCancel={cancelArrange} onSave={saveArrange} />
      ) : (
        <Hud
          config={config}
          mapSize={prepared.map}
          room={room}
          status={status}
          onStatus={changeStatus}
          settings={settings}
          prompt={panel ? null : prompt}
          onInteract={() => bus.emit("request-interact")}
          onSound={() => toggleSound(!settings.sound)}
          onSettings={() => setPanel("settings")}
          onMembers={() => setPanel("members")}
          onNotices={() => setPanel("notices")}
          onStats={() => setPanel("stats")}
          swapsWaiting={swapsWaiting.length}
          live={
            workspaceId
              ? {
                  online: liveState === "online",
                  here: peers.length + 1,
                  unread,
                  voiceOn: voice.on,
                  talkingWith: voice.talkingWith.map((id) => names.get(id) ?? "a teammate"),
                  onChat: () => setChat((c) => (c ? null : "office")),
                  onPeople: () => setChat("people"),
                  onVoice: () => {
                    voice.toggle();
                    if (!voice.on) say("Mic on — walk up to a teammate with their mic on to talk. Further away is quieter.");
                  },
                }
              : undefined
          }
        />
      )}
      {liveState === "replaced" && (
        <p role="status" className="absolute inset-x-0 bottom-20 mx-auto w-fit max-w-[90vw] border-2 border-ink bg-sun px-3 py-2 text-sm font-semibold shadow-pixel-sm">
          This office is open in another tab, so teammates can’t see you here.{" "}
          <button type="button" className="underline" onClick={() => live?.reconnect()}>
            Use this tab
          </button>
        </p>
      )}
      <AnimatePresence>
        {chat && workspaceId && !arrange && (
          <ChatDrawer
            key="chat"
            workspaceId={workspaceId}
            live={live}
            liveState={liveState}
            room={room}
            peers={peers}
            nearby={nearby}
            myName={config.displayName}
            myStatus={status}
            initialTab={chat}
            onSay={sayNearby}
            onFocusChange={setTyping}
            onClose={() => setChat(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{toast && <Toast key={toast.id} text={toast.text} />}</AnimatePresence>
      <AnimatePresence>
        {panel && (
          <OfficePanel
            key={panel}
            id={panel}
            seats={seats}
            config={config}
            status={status}
            onStatus={changeStatus}
            settings={settings}
            actions={panelActions}
            onSettings={(patch) => {
              if (patch.sound !== undefined) setSound(patch.sound);
              setSettings((s) => ({ ...s, ...patch, sound: patch.sound ?? s.sound }));
              persistPrefs(patch);
            }}
            onClose={() => setPanel(null)}
            meeting={{
              room,
              canCall: !!live?.callRooms.includes(room),
              inCall: peers.filter((p) => p.call === room).map((p) => p.name),
              full: peers.filter((p) => p.call === room).length >= CALL_MAX,
              onJoin: () => {
                setPanel(null);
                call.join(room);
              },
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {call.room && (
          <CallView
            key="call"
            room={call.room}
            local={call.local}
            frames={media.frames}
            streams={call.streams}
            talking={callTalking}
            peers={peers}
            myName={config.displayName}
            muted={call.muted}
            cameraOff={call.cameraOff}
            hasVideo={call.hasVideo}
            onMute={call.toggleMute}
            onCamera={call.toggleCamera}
            onLeave={call.leave}
          />
        )}
      </AnimatePresence>
      {(!ready || failed) && (
        <div className="absolute inset-0 grid place-items-center bg-forest-deep p-4">
          <LoadingCard
            title={failed ? "The office couldn’t start" : "Opening the office…"}
            error={failed}
            onRetry={() => window.location.reload()}
          />
        </div>
      )}
    </main>
  );
}
