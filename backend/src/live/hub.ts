import type { FastifyBaseLogger } from "fastify";
import type { RawData, WebSocket } from "ws";
import {
  AVATAR_ANIMS,
  CALL_MAX,
  CLOSE,
  MAX_AUDIO_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA,
  MEDIA_ID_LEN,
  SAY_MAX,
  SAY_RADIUS,
  VOICE_DROP,
  isCallRoom,
  type ClientMsg,
  type PeerView,
  type Pose,
  type ServerMsg,
} from "@/components/office/live/protocol";

/**
 * Who is in each office right now. One socket per member: opening the office in
 * a second tab takes over from the first. Kept in memory, so it's per API
 * process (several processes would need a shared pub/sub, e.g. Redis).
 */

type Peer = PeerView & {
  socket: WebSocket;
  alive: boolean;
  moves: Bucket;
  says: Bucket;
  audio: Bucket;
  video: Bucket;
  signals: Bucket;
  /** Teammates this peer reaches over a direct WebRTC link: their media isn't relayed. */
  direct: Set<string>;
};
type Space = { peers: Map<string, Peer>; callRooms: Set<string>; width: number; height: number };

/** A small token bucket: `rate` actions per second, bursts up to `burst`. */
class Bucket {
  private tokens: number;
  private at = Date.now();
  constructor(
    private rate: number,
    private burst: number,
  ) {
    this.tokens = burst;
  }
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const HEARTBEAT_MS = 25_000;
const ANIMS = new Set<string>(AVATAR_ANIMS);

const view = (p: Peer): PeerView => ({
  id: p.id,
  name: p.name,
  avatarId: p.avatarId,
  status: p.status,
  room: p.room,
  voice: p.voice,
  call: p.call,
  x: p.x,
  y: p.y,
  frame: p.frame,
  anim: p.anim,
  flip: p.flip,
  depth: p.depth,
});

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** The office as far as the live hub cares: its size and which rooms host calls. */
export type LiveOffice = { width?: number; height?: number; rooms?: { name: string }[] } | null | undefined;

function officeShape(office: LiveOffice) {
  const rooms = Array.isArray(office?.rooms) ? office.rooms.map((r) => r.name).filter((n) => typeof n === "string") : [];
  return { callRooms: new Set(rooms.filter(isCallRoom)), width: (office?.width ?? 0) * 16, height: (office?.height ?? 0) * 16 };
}

class LiveHub {
  private spaces = new Map<string, Space>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private log: FastifyBaseLogger | null = null;

  start(log: FastifyBaseLogger) {
    this.log = log;
    if (this.timer) return;
    // Drop sockets that stopped answering pings (laptop lid closed, network gone).
    this.timer = setInterval(() => {
      for (const space of this.spaces.values()) {
        for (const p of space.peers.values()) {
          if (!p.alive) {
            p.socket.terminate();
            continue;
          }
          p.alive = false;
          p.socket.ping();
        }
      }
    }, HEARTBEAT_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const space of this.spaces.values()) for (const p of space.peers.values()) p.socket.close(1001, "Server shutting down");
    this.spaces.clear();
  }

  /**
   * A member opened the office. `onClose` runs once their socket closes (for
   * saving last-seen); it doesn't run when a newer tab took over.
   */
  join(
    workspaceId: string,
    office: LiveOffice,
    who: Omit<PeerView, "room" | "voice" | "call" | "frame" | "anim" | "flip" | "depth">,
    socket: WebSocket,
    onClose: () => void,
  ) {
    let space = this.spaces.get(workspaceId);
    if (!space) {
      space = { peers: new Map(), ...officeShape(office) };
      this.spaces.set(workspaceId, space);
    }
    const old = space.peers.get(who.id);
    if (old) {
      this.log?.info({ workspaceId, member: who.name }, "🔁 Live: office opened in another tab — closing the old one");
      space.peers.delete(who.id);
      old.socket.close(CLOSE.replaced, "Opened in another tab");
    }
    const peer: Peer = {
      ...who,
      room: "",
      voice: false,
      call: null,
      frame: 5,
      anim: null,
      flip: false,
      depth: who.y,
      socket,
      alive: true,
      moves: new Bucket(20, 30),
      says: new Bucket(0.5, 3),
      // 50 audio frames a second (20 ms each) plus slack; video is a few frames a second.
      audio: new Bucket(70, 100),
      video: new Bucket(12, 20),
      signals: new Bucket(50, 200),
      direct: new Set(),
    };
    const others = [...space.peers.values()].map(view);
    space.peers.set(peer.id, peer);
    this.send(peer, { t: "welcome", you: peer.id, peers: others, callRooms: [...space.callRooms] });
    this.broadcast(workspaceId, { t: "join", peer: view(peer) }, peer.id);
    this.log?.info({ workspaceId, member: peer.name, online: space.peers.size }, "🟢 Live: member came online");

    socket.on("pong", () => (peer.alive = true));
    socket.on("message", (raw, isBinary) => {
      peer.alive = true;
      if (isBinary) return this.relayMedia(workspaceId, peer, raw);
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return this.send(peer, { t: "error", message: "Couldn't read that message." });
      }
      this.handle(workspaceId, peer, msg);
    });
    socket.on("close", () => {
      const s = this.spaces.get(workspaceId);
      // A newer tab already replaced this peer: nothing to announce.
      if (!s || s.peers.get(peer.id) !== peer) return;
      s.peers.delete(peer.id);
      this.broadcast(workspaceId, { t: "leave", id: peer.id });
      if (!s.peers.size) this.spaces.delete(workspaceId);
      this.log?.info({ workspaceId, member: peer.name, online: s.peers.size }, "⚪ Live: member went offline");
      onClose();
    });
  }

  private handle(workspaceId: string, peer: Peer, msg: ClientMsg) {
    const space = this.spaces.get(workspaceId);
    if (!space || !msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "move": {
        if (!peer.moves.take()) return;
        if (!this.validPose(space, msg)) return;
        peer.x = Math.round(msg.x);
        peer.y = Math.round(msg.y);
        peer.frame = msg.frame;
        peer.anim = msg.anim;
        peer.flip = !!msg.flip;
        peer.depth = msg.depth;
        peer.room = typeof msg.room === "string" ? msg.room.slice(0, 40) : "";
        // Walking out of a call room hangs up.
        // (An empty room is a map that's still loading, not a walk out.)
        if (peer.call && peer.room && peer.room !== peer.call) this.setCall(workspaceId, peer, null);
        const { x, y, frame, anim, flip, depth, room } = peer;
        return this.broadcast(workspaceId, { t: "move", id: peer.id, x, y, frame, anim, flip, depth, room }, peer.id);
      }
      case "say": {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, SAY_MAX) : "";
        if (!text) return;
        if (!peer.says.take()) return this.send(peer, { t: "error", message: "Slow down a little — give people a moment to read." });
        // Only people standing nearby hear it (and the speaker sees their own bubble).
        for (const other of space.peers.values()) {
          if (other === peer || Math.hypot(other.x - peer.x, other.y - peer.y) <= SAY_RADIUS) this.send(other, { t: "say", id: peer.id, text });
        }
        return;
      }
      case "voice": {
        const on = !!msg.on;
        if (on === peer.voice) return;
        peer.voice = on;
        return this.broadcast(workspaceId, { t: "peer", id: peer.id, patch: { voice: on } });
      }
      case "call": {
        const room = msg.room === null ? null : typeof msg.room === "string" ? msg.room : undefined;
        if (room === undefined) return;
        if (room !== null) {
          if (!space.callRooms.has(room)) return this.send(peer, { t: "error", message: "Video calls happen in the meeting room and call booths." });
          const inCall = [...space.peers.values()].filter((p) => p.call === room && p !== peer).length;
          if (inCall >= CALL_MAX) return this.send(peer, { t: "error", message: `That call is full (${CALL_MAX} people).` });
        }
        return this.setCall(workspaceId, peer, room);
      }
      case "signal": {
        if (!peer.signals.take()) return;
        const to = typeof msg.to === "string" ? space.peers.get(msg.to) : undefined;
        if (!to || to === peer || typeof msg.link !== "string" || msg.link.length > 120 || !msg.data || typeof msg.data !== "object") return;
        // Links are named after both ends, so nobody can butt into someone else's connection.
        if (!msg.link.includes(peer.id) || !msg.link.includes(to.id)) return;
        return this.send(to, { t: "signal", from: peer.id, link: msg.link, data: msg.data });
      }
      case "direct": {
        if (!Array.isArray(msg.ids)) return;
        peer.direct = new Set(msg.ids.filter((id) => typeof id === "string" && space.peers.has(id)).slice(0, 32));
        return;
      }
    }
  }

  /**
   * Voice and video frames. In a call they go to everyone in the same call;
   * otherwise a speaker with the mic on is heard by every nearby teammate who
   * isn't in a call — listeners don't need their own mic on. The sender's id is
   * put in front so listeners know who's talking.
   */
  private relayMedia(workspaceId: string, peer: Peer, raw: RawData) {
    const space = this.spaces.get(workspaceId);
    const data = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (!space || data.length < 2) return;
    const kind = data[0];
    const payload = data.subarray(1);
    if (kind === MEDIA.audio) {
      if (payload.length > MAX_AUDIO_BYTES || !peer.audio.take()) return;
    } else if (kind === MEDIA.video) {
      if (payload.length > MAX_VIDEO_BYTES || !peer.video.take() || !peer.call) return;
    } else return;
    const to = [...space.peers.values()].filter((o) => {
      // Already hearing/seeing this peer over a direct link.
      if (o === peer || peer.direct.has(o.id)) return false;
      if (peer.call) return o.call === peer.call;
      return peer.voice && !o.call && Math.hypot(o.x - peer.x, o.y - peer.y) <= VOICE_DROP;
    });
    if (!to.length) return;
    const out = Buffer.concat([Buffer.from([kind]), Buffer.from(peer.id.padEnd(MEDIA_ID_LEN).slice(0, MEDIA_ID_LEN), "ascii"), payload]);
    for (const o of to) {
      // A listener on a slow connection skips frames instead of falling behind.
      if (o.socket.readyState === o.socket.OPEN && o.socket.bufferedAmount < 512 * 1024) o.socket.send(out, { binary: true });
    }
  }

  private validPose(space: Space, p: Partial<Pose>) {
    const w = space.width || 1e5;
    const h = space.height || 1e5;
    return (
      num(p.x, 0, w) &&
      num(p.y, 0, h + 16) &&
      num(p.frame, 0, 64) &&
      num(p.depth, -10, 1e6) &&
      (p.anim === null || (typeof p.anim === "string" && ANIMS.has(p.anim)))
    );
  }

  private setCall(workspaceId: string, peer: Peer, room: string | null) {
    if (peer.call === room) return;
    peer.call = room;
    this.broadcast(workspaceId, { t: "peer", id: peer.id, patch: { call: room } });
    this.log?.info({ workspaceId, member: peer.name, call: room ?? "left" }, room ? "📹 Live: joined a video call" : "📹 Live: left a video call");
  }

  private send(peer: Peer, msg: ServerMsg) {
    if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(JSON.stringify(msg));
  }

  /** Send to everyone in the office (except `exceptId`). */
  broadcast(workspaceId: string, msg: ServerMsg, exceptId?: string) {
    const space = this.spaces.get(workspaceId);
    if (!space) return;
    const data = JSON.stringify(msg);
    for (const p of space.peers.values()) if (p.id !== exceptId && p.socket.readyState === p.socket.OPEN) p.socket.send(data);
  }

  /** A member's name tag, avatar or status changed (saved through the REST API). */
  update(workspaceId: string, memberId: string, patch: Partial<Pick<PeerView, "name" | "avatarId" | "status">>) {
    const peer = this.spaces.get(workspaceId)?.peers.get(memberId);
    if (peer) Object.assign(peer, patch);
    this.broadcast(workspaceId, { t: "peer", id: memberId, patch });
  }

  /** The office was rebuilt or its furniture moved: everyone reloads it. */
  officeChanged(workspaceId: string, office: LiveOffice, by: { id: string; name: string }) {
    const space = this.spaces.get(workspaceId);
    if (!space) return;
    Object.assign(space, officeShape(office));
    // The owner's own tab reloads by itself.
    this.broadcast(workspaceId, { t: "office-changed", by: by.name }, by.id);
  }

  /** Close a member's socket: they left or were removed. */
  kick(workspaceId: string, memberId: string, reason: string) {
    const peer = this.spaces.get(workspaceId)?.peers.get(memberId);
    peer?.socket.close(CLOSE.gone, reason);
  }

  /** The workspace was deleted: close everyone's socket. */
  closeSpace(workspaceId: string, reason: string) {
    const space = this.spaces.get(workspaceId);
    if (!space) return;
    for (const p of space.peers.values()) p.socket.close(CLOSE.gone, reason);
  }

  /** Member ids currently in the office. */
  online(workspaceId: string): Set<string> {
    return new Set(this.spaces.get(workspaceId)?.peers.keys() ?? []);
  }
}

export const live = new LiveHub();
