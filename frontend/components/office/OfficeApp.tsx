"use client";

import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MotionProvider } from "@/components/motion/Motion";
import { OfficeAudio } from "./audio";
import { createGame } from "./game/createGame";
import { GameBus, type GameEvents } from "./game/events";
import { seatFor } from "./game/seating";
import { Hud, PlayerAnchor, Toast, type Settings, type Status } from "./hud";
import { OfficePanel, type OfficeActions, type PanelId } from "./panels";
import type { LayoutId } from "@/components/onboarding/model";
import { NoWorkspaceError, prepareOffice, resetPreparedOffice, type PreparedOffice } from "./prepare";
import { changeOffice, savePosition, savePreferences, saveStatus, type OfficeChange } from "./service";
import { saveProfile, takeDesk } from "@/components/team/service";
import { ApiError } from "@/lib/api";
import { LoadingCard } from "./LoadingScreen";
import { useSwapRequests } from "./useSwapRequests";

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

  const actions = useMemo<OfficeActions>(
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
  actions: OfficeActions;
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

  /** Save changed settings to the account. */
  const persistPrefs = useCallback((patch: Partial<Settings>) => {
    savePreferences(patch).catch((err) => console.error("[office] couldn't save settings", err));
  }, []);

  const say = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

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
    const off = [bus.on("ready", () => setReady(true)), bus.on("prompt", setPrompt), bus.on("room", setRoom)];
    return () => {
      cancelAnimationFrame(frame);
      off.forEach((fn) => fn());
      bus.setAnchor(null);
      game?.destroy(true);
      // A new map is starting: forget the old one's prompt and room.
      setReady(false);
      setPrompt(null);
      setRoom("");
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
            return say("Fresh coffee brewed. Enjoy a little break.");
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
    [bus, audio, say, toggleSound, workspaceId, reload],
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

  // Panels pause movement (re-sent when a new map is ready); Escape closes them.
  useEffect(() => {
    bus.emit("set-paused", panel !== null);
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, bus, ready]);

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
      <PlayerAnchor ref={anchor} name={config.displayName} status={status} showName={settings.nameTag} prompt={panel ? null : prompt} />
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
        swapsWaiting={swapsWaiting.length}
      />
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
            actions={actions}
            onSettings={(patch) => {
              if (patch.sound !== undefined) setSound(patch.sound);
              setSettings((s) => ({ ...s, ...patch, sound: patch.sound ?? s.sound }));
              persistPrefs(patch);
            }}
            onClose={() => setPanel(null)}
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
