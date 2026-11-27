import { useCallback, useEffect, useRef, useState } from "react";
import type { GameBus } from "../game/events";
import { LiveClient, type LiveState } from "./client";
import { CameraCapture, FrameStore, MicCapture, VoicePlayer, pack } from "./media";
import { Mesh } from "./mesh";
import { MEDIA, VOICE_DROP, VOICE_RADIUS, callLink, proxLink, type PeerView, type Pose, type ServerMsg } from "./protocol";

/** How often the player's pose is sent while it changes (ms). */
const SEND_MS = 100;
/** Speech bubbles stay up this long (ms). */
const BUBBLE_MS = 6000;

export type Bubble = { text: string; at: number };
/** Something said out loud near you (not stored anywhere). */
export type NearbyLine = { id: string; name: string; text: string; at: number; you: boolean };

const samePose = (a: (Pose & { room: string }) | null, b: Pose & { room: string }) =>
  !!a && a.x === b.x && a.y === b.y && a.frame === b.frame && a.anim === b.anim && a.flip === b.flip && a.depth === b.depth && a.room === b.room;

/**
 * The live office for one workspace: connects, sends the player's pose while
 * it changes, hands teammates' avatars to the game and keeps a React copy of
 * who is here (name, status, room, voice, call — not positions, which only the
 * game needs every frame).
 */
export function useLive(
  workspaceId: string | undefined,
  bus: GameBus,
  ready: boolean,
  handlers: { onOfficeChanged?: (by: string) => void; onError?: (message: string) => void },
) {
  const [live, setLive] = useState<LiveClient | null>(null);
  const [state, setState] = useState<LiveState>("connecting");
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [nearby, setNearby] = useState<NearbyLine[]>([]);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!workspaceId) return;
    const client = new LiveClient(workspaceId);
    setLive(client);
    const snapshot = () => setPeers([...client.peers.values()].map((p) => ({ ...p })));
    const offState = client.onState(setState);
    const off = client.on((msg: ServerMsg) => {
      switch (msg.t) {
        case "welcome":
          msg.peers.forEach((p) => bus.emit("peer-upsert", p));
          return snapshot();
        case "join":
          bus.emit("peer-upsert", msg.peer);
          return snapshot();
        case "leave":
          bus.emit("peer-leave", msg.id);
          return snapshot();
        case "move": {
          const { t: _t, room, ...pose } = msg;
          bus.emit("peer-move", pose);
          // React only cares when someone walks into another room.
          return setPeers((list) => (list.some((p) => p.id === msg.id && p.room !== room) ? list.map((p) => (p.id === msg.id ? { ...p, room } : p)) : list));
        }
        case "peer": {
          const p = client.peers.get(msg.id);
          if (p && msg.patch.avatarId) bus.emit("peer-upsert", p);
          return snapshot();
        }
        case "say": {
          const at = Date.now();
          const you = msg.id === client.me;
          const name = you ? "You" : (client.peers.get(msg.id)?.name ?? "Someone");
          setNearby((lines) => [...lines.slice(-49), { id: msg.id, name, text: msg.text, at, you }]);
          return setBubbles((b) => ({ ...b, [msg.id]: { text: msg.text, at } }));
        }
        case "office-changed":
          return handlersRef.current.onOfficeChanged?.(msg.by);
        case "error":
          return handlersRef.current.onError?.(msg.message);
      }
    });
    client.connect();
    return () => {
      off();
      offState();
      client.close();
      setLive(null);
      setPeers([]);
    };
  }, [workspaceId, bus]);

  // A new map (after a reload) starts empty: hand it everyone who's here.
  useEffect(() => {
    if (!ready || !live) return;
    live.peers.forEach((p) => bus.emit("peer-upsert", p));
  }, [ready, live, bus]);

  // Send the player's pose ~10 times a second while it changes.
  useEffect(() => {
    if (!ready || !live || state !== "online") return;
    let last: (Pose & { room: string }) | null = null;
    const timer = setInterval(() => {
      const pose = bus.poseOf?.();
      if (!pose || samePose(last, pose)) return;
      last = pose;
      live.send({ t: "move", ...pose });
    }, SEND_MS);
    return () => clearInterval(timer);
  }, [ready, live, state, bus]);

  // Old speech bubbles fade away.
  useEffect(() => {
    if (!Object.keys(bubbles).length) return;
    const t = setInterval(() => {
      const now = Date.now();
      setBubbles((b) => {
        const kept = Object.fromEntries(Object.entries(b).filter(([, v]) => now - v.at < BUBBLE_MS));
        return Object.keys(kept).length === Object.keys(b).length ? b : kept;
      });
    }, 500);
    return () => clearInterval(t);
  }, [bubbles]);

  const say = useCallback((text: string) => live?.send({ t: "say", text }), [live]);

  return { live, state, peers, bubbles, nearby, say };
}

/** Distance from the player (feet) to a teammate. */
const distanceTo = (bus: GameBus, p: Pose) => {
  const me = bus.poseOf?.();
  return me ? Math.hypot(me.x - p.x, me.y - p.y) : Infinity;
};

/** 1 when close, fading to 0 at the drop distance. */
const volumeAt = (d: number) => Math.max(0, Math.min(1, 1 - (d - VOICE_RADIUS / 2) / (VOICE_DROP - VOICE_RADIUS / 2)));

/** Someone heard within this long counts as talking (ms). */
const TALKING_MS = 800;

/**
 * Shared by voice and calls (one per office page): relay playback, the call's
 * video snapshots, and who we reach directly over WebRTC (voice / call).
 */
export type Media = { player: VoicePlayer; frames: FrameStore; direct: { voice: Set<string>; call: Set<string>; sent: string } };
export const createMedia = (): Media => ({ player: new VoicePlayer(), frames: new FrameStore(), direct: { voice: new Set(), call: new Set(), sent: "" } });

/** Tell the server who we reach directly, so it stops relaying our media to them. */
function syncDirect(live: LiveClient, media: Media) {
  const ids = [...new Set([...media.direct.voice, ...media.direct.call])].sort();
  const key = ids.join(",");
  if (key === media.direct.sent) return;
  media.direct.sent = key;
  live.send({ t: "direct", ids });
}
const isDirect = (media: Media, id: string) => media.direct.voice.has(id) || media.direct.call.has(id);

/**
 * Proximity voice: with the mic on, you hear (and are heard by) teammates who
 * also have voice on and stand close by, louder the closer they are. Each pair
 * connects directly (WebRTC, lowest latency) when the network allows; otherwise
 * the API relays the audio over the live socket. Also plays relayed call media.
 */
export function useVoice(live: LiveClient | null, bus: GameBus, media: Media, callRoom: string | null, onError: (message: string) => void) {
  const [on, setOn] = useState(false);
  const [talkingWith, setTalkingWith] = useState<string[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const mesh = useRef<Mesh | null>(null);
  const audio = useRef(new Map<string, HTMLAudioElement>());
  const [directPeers, setDirectPeers] = useState<string[]>([]);
  const callRef = useRef(callRoom);
  useEffect(() => {
    callRef.current = callRoom;
  }, [callRoom]);

  // Direct links to nearby teammates; their audio plays through <audio> elements.
  useEffect(() => {
    if (!live) return;
    const els = audio.current;
    const m = new Mesh(live, "prox", () => {
      for (const [id, el] of els)
        if (!m.links.has(id)) {
          el.srcObject = null;
          els.delete(id);
        }
      for (const link of m.links.values()) {
        if (!link.remote) continue;
        let el = els.get(link.id);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          els.set(link.id, el);
        }
        if (el.srcObject !== link.remote) {
          el.srcObject = link.remote;
          el.play().catch(() => {});
        }
      }
      const ids = m.connected().map((l) => l.peer);
      media.direct.voice = new Set(ids);
      syncDirect(live, media);
      setDirectPeers(ids);
    });
    mesh.current = m;
    return () => {
      m.dispose();
      mesh.current = null;
      els.forEach((el) => (el.srcObject = null));
      els.clear();
      media.direct.voice = new Set();
    };
  }, [live, media]);

  // Who to connect to directly: nearby teammates with voice on; volume by distance.
  useEffect(() => {
    if (!live || !on) return;
    const tick = () => {
      const m = mesh.current;
      const me = live.me;
      if (!m || !me) return;
      const wanted = new Map<string, string>();
      if (!callRoom) {
        for (const p of live.peers.values()) {
          if (!p.voice || p.call) continue;
          const id = proxLink(me, p.id);
          const d = distanceTo(bus, p);
          if (d <= VOICE_RADIUS || (m.links.has(id) && d <= VOICE_DROP)) wanted.set(id, p.id);
          const el = audio.current.get(id);
          if (el) el.volume = volumeAt(d);
        }
      }
      m.reconcile(wanted);
    };
    tick();
    const t = setInterval(tick, 300);
    return () => clearInterval(t);
  }, [live, on, callRoom, bus]);

  // Everything relayed to us: audio by distance (or full volume from your call), video snapshots for call tiles.
  useEffect(() => {
    if (!live) return;
    return live.onMedia(({ kind, id, payload }) => {
      const peer = live.peers.get(id);
      if (!peer) return;
      // Already coming in over a direct link (a few relayed frames can overlap while it connects).
      if (isDirect(media, id)) return;
      if (kind === MEDIA.video) return media.frames.put(id, payload);
      if (kind !== MEDIA.audio) return;
      const inMyCall = !!callRef.current && peer.call === callRef.current;
      media.player.play(id, payload, inMyCall ? 1 : callRef.current ? 0 : volumeAt(distanceTo(bus, peer)));
    });
  }, [live, bus, media]);

  // Who you're hearing nearby, for the HUD and the mic icons on name tags.
  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      const relayed = [...media.player.heard].filter(([id, at]) => now - at < TALKING_MS && !live?.peers.get(id)?.call).map(([id]) => id);
      const ids = [...new Set([...directPeers, ...relayed])].sort();
      setTalkingWith((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids));
    }, 400);
    return () => clearInterval(t);
  }, [live, media, directPeers]);

  // Tell the office whether our mic is on (again after reconnecting).
  useEffect(() => {
    if (!live) return;
    live.send({ t: "voice", on });
    return live.on((msg) => msg.t === "welcome" && on && live.send({ t: "voice", on: true }));
  }, [live, on]);

  const stop = useCallback(() => {
    mesh.current?.setLocal(null);
    mesh.current?.reconcile(new Map());
    mic.current?.stop();
    mic.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const toggle = useCallback(async () => {
    if (on) {
      setOn(false);
      return stop();
    }
    media.player.resume();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.current = s;
      mesh.current?.setLocal(s);
      const capture = new MicCapture();
      mic.current = capture;
      // In a call, the call sends your voice instead.
      await capture.start(s, (bytes) => !callRef.current && live?.sendMedia(pack(MEDIA.audio, bytes)));
      setOn(true);
    } catch {
      stop();
      onError("Couldn’t use your microphone. Allow it in the browser to talk with people nearby.");
    }
  }, [on, live, media, stop, onError]);

  // Release the mic when the office closes.
  useEffect(() => stop, [stop]);

  return { on, toggle, talkingWith };
}

/**
 * Video calls in the meeting room and call booths: everyone in the same room's
 * call hears everyone and sees their camera (up to CALL_MAX people). Pairs
 * connect directly (real video, lowest latency) when they can; otherwise the API
 * relays the sound and a few JPEG snapshots a second.
 */
export function useCall(live: LiveClient | null, peers: PeerView[], media: Media, onError: (message: string) => void) {
  const [room, setRoom] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const roomRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const captures = useRef<{ mic: MicCapture; cam: CameraCapture | null } | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const mesh = useRef<Mesh | null>(null);
  /** Teammates' streams over direct links (their tiles show real video). */
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());

  useEffect(() => {
    if (!live) return;
    const m = new Mesh(live, "call", () => {
      const connected = m.connected();
      media.direct.call = new Set(connected.map((l) => l.peer));
      syncDirect(live, media);
      setStreams(new Map(connected.map((l) => [l.peer, l.remote!])));
    });
    mesh.current = m;
    return () => {
      m.dispose();
      mesh.current = null;
      media.direct.call = new Set();
    };
  }, [live, media]);

  // Connect directly to everyone else in this room's call.
  useEffect(() => {
    const m = mesh.current;
    const me = live?.me;
    if (!m || !me) return;
    const wanted = new Map<string, string>();
    if (room) for (const p of peers) if (p.call === room) wanted.set(callLink(room, me, p.id), p.id);
    m.reconcile(wanted);
    if (!room) return;
    const t = setInterval(() => m.reconcile(wanted), 1500);
    return () => clearInterval(t);
  }, [live, peers, room]);

  const stopCapture = useCallback(() => {
    mesh.current?.setLocal(null);
    mesh.current?.reconcile(new Map());
    captures.current?.mic.stop();
    captures.current?.cam?.stop();
    captures.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
  }, []);

  const leave = useCallback(() => {
    const was = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    if (was) live?.send({ t: "call", room: null });
    stopCapture();
    media.frames.clear();
    mutedRef.current = cameraOffRef.current = false;
    setMuted(false);
    setCameraOff(false);
  }, [live, media, stopCapture]);

  const join = useCallback(
    async (name: string) => {
      if (!live) return;
      media.player.resume();
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 640 }, height: { ideal: 360 } } });
      } catch {
        try {
          // No camera (or it's blocked): join with sound only.
          s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          onError("No camera available — you joined with sound only.");
        } catch {
          return onError("Couldn’t use your camera or microphone. Allow them in the browser to join the call.");
        }
      }
      localRef.current = s;
      setLocal(s);
      mesh.current?.setLocal(s);
      const mic = new MicCapture();
      const cam = s.getVideoTracks().length ? new CameraCapture() : null;
      captures.current = { mic, cam };
      roomRef.current = name;
      setRoom(name);
      live.send({ t: "call", room: name });
      cam?.start(s, (bytes) => !cameraOffRef.current && live.sendMedia(pack(MEDIA.video, bytes), true));
      try {
        await mic.start(s, (bytes) => !mutedRef.current && live.sendMedia(pack(MEDIA.audio, bytes)));
      } catch {
        onError("Couldn’t start your microphone for the call.");
      }
    },
    [live, media, onError],
  );

  useEffect(() => {
    if (!live) return;
    return live.on((msg) => {
      // Reconnected: the server forgot our call, so join again.
      if (msg.t === "welcome" && roomRef.current) live.send({ t: "call", room: roomRef.current });
      if (!roomRef.current) return;
      // The server refused (call full, not a call room) or hung us up (walked out of the room).
      if (msg.t === "error" && /call/i.test(msg.message)) leave();
      if (msg.t === "peer" && msg.id === live.me && msg.patch.call === null) leave();
    });
  }, [live, leave]);

  // Muting / camera off: disabling the track silences direct links; the flags stop the relay.
  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
    setMuted(mutedRef.current);
  }, []);

  const toggleCamera = useCallback(() => {
    cameraOffRef.current = !cameraOffRef.current;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = !cameraOffRef.current));
    setCameraOff(cameraOffRef.current);
  }, []);

  // Hang up when the office closes.
  useEffect(() => stopCapture, [stopCapture]);

  return { room, local, streams, join, leave, muted, cameraOff, toggleMute, toggleCamera, hasVideo: !!local?.getVideoTracks().length };
}
