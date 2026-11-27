import { API_URL } from "@/lib/api";
import { unpack } from "./media";
import { CLOSE, type ClientMsg, type PeerView, type ServerMsg } from "./protocol";

export type LiveState = "connecting" | "online" | "offline" | "replaced" | "gone";

type Listener = (msg: ServerMsg) => void;
/** A relayed voice or video frame: who sent it and the bytes. */
export type MediaFrame = { kind: number; id: string; payload: Uint8Array };

/** Don't queue more than this on a slow upload; video frames are dropped instead. */
const MAX_BUFFERED = 256 * 1024;

/** ws(s)://… for the API's http(s)://… (or this page's own host when the API shares its origin). */
export function liveUrl(workspaceId: string) {
  const base = API_URL ? API_URL.replace(/^http/, "ws") : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return `${base}/api/workspaces/${encodeURIComponent(workspaceId)}/live`;
}

/**
 * The office's live connection. Keeps the latest view of every teammate in
 * the office (`peers`), reconnects with backoff when the network drops, and
 * stops for good when the server says this tab was replaced or the member is
 * gone. Plain TypeScript: React and Phaser listen through `on`.
 */
export class LiveClient {
  readonly peers = new Map<string, PeerView>();
  me: string | null = null;
  callRooms: string[] = [];
  state: LiveState = "connecting";

  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private mediaListeners = new Set<(f: MediaFrame) => void>();
  private stateListeners = new Set<(s: LiveState) => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private workspaceId: string,
    private makeSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  connect() {
    if (this.closed || this.socket) return;
    this.setState("connecting");
    let ws: WebSocket;
    try {
      ws = this.makeSocket(liveUrl(this.workspaceId));
    } catch {
      return this.scheduleRetry();
    }
    this.socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      if (this.socket !== ws) return;
      if (e.data instanceof ArrayBuffer) {
        const frame = unpack(e.data);
        if (frame) this.mediaListeners.forEach((fn) => fn(frame));
        return;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.apply(msg);
      this.listeners.forEach((fn) => fn(msg));
    };
    ws.onclose = (e) => {
      // An older socket closing after `reconnect` or `close` changes nothing.
      if (this.socket !== ws) return;
      this.socket = null;
      // Everyone else left our view: the next welcome lists who's there.
      const had = [...this.peers.keys()];
      this.peers.clear();
      had.forEach((id) => this.listeners.forEach((fn) => fn({ t: "leave", id })));
      if (this.closed) return;
      if (e.code === CLOSE.replaced) return this.setState("replaced");
      if (e.code === CLOSE.gone || e.code === CLOSE.denied || e.code === CLOSE.origin) return this.setState("gone");
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    this.setState("offline");
    // 1 s, 2 s, 4 s … up to 30 s, with a little jitter so a server restart isn't stampeded.
    const wait = Math.min(30_000, 1000 * 2 ** this.retry) * (0.8 + Math.random() * 0.4);
    this.retry = Math.min(this.retry + 1, 5);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, wait);
  }

  /** Keep `peers` in step with what the server says. */
  private apply(msg: ServerMsg) {
    switch (msg.t) {
      case "welcome":
        this.retry = 0;
        this.me = msg.you;
        this.callRooms = msg.callRooms;
        this.peers.clear();
        msg.peers.forEach((p) => this.peers.set(p.id, p));
        return this.setState("online");
      case "join":
        return void this.peers.set(msg.peer.id, msg.peer);
      case "leave":
        return void this.peers.delete(msg.id);
      case "move": {
        const p = this.peers.get(msg.id);
        if (!p) return;
        const { t: _t, id: _id, ...pose } = msg;
        return void Object.assign(p, pose);
      }
      case "peer": {
        const p = this.peers.get(msg.id);
        if (p) Object.assign(p, msg.patch);
        return;
      }
    }
  }

  send(msg: ClientMsg) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  /** Send a voice/video frame. `droppable` frames are skipped when the upload is backed up. */
  sendMedia(frame: Uint8Array, droppable = false) {
    const ws = this.socket;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    if (droppable && ws.bufferedAmount > MAX_BUFFERED) return false;
    ws.send(frame);
    return true;
  }

  onMedia(fn: (f: MediaFrame) => void) {
    this.mediaListeners.add(fn);
    return () => void this.mediaListeners.delete(fn);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  onState(fn: (s: LiveState) => void) {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  }

  private setState(s: LiveState) {
    if (s === this.state) return;
    this.state = s;
    this.stateListeners.forEach((fn) => fn(s));
  }

  /** Try again now (e.g. "Reconnect" after this tab was replaced). */
  reconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.retry = 0;
    this.closed = false;
    this.socket?.close();
    this.socket = null;
    this.connect();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close(1000, "Left the office");
    this.socket = null;
    this.listeners.clear();
    this.mediaListeners.clear();
    this.stateListeners.clear();
  }
}
