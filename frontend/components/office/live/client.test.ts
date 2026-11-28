import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveClient } from "./client";
import { CLOSE, type ServerMsg } from "./protocol";

/** Just enough of a WebSocket for the client: the test plays the server. */
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  serverSays(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverCloses(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const peer = (id: string, name: string) => ({ id, name, avatarId: "buddy-maya", status: "available" as const, room: "", voice: false, call: null, x: 10, y: 20, frame: 5, anim: null, flip: false, depth: 20 });

describe("LiveClient", () => {
  let sockets: FakeSocket[];
  let client: LiveClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    sockets = [];
    client = new LiveClient("ws1", (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    });
  });

  afterEach(() => {
    client.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the workspace's live route and tracks who's here", () => {
    client.connect();
    expect(sockets[0].url).toMatch(/^ws:\/\/.+\/api\/workspaces\/ws1\/live$/);
    sockets[0].serverSays({ t: "welcome", you: "me", peers: [peer("a", "Ana")], callRooms: ["Meeting room"] });
    expect(client.state).toBe("online");
    expect(client.me).toBe("me");
    expect(client.callRooms).toEqual(["Meeting room"]);

    sockets[0].serverSays({ t: "join", peer: peer("b", "Ben") });
    sockets[0].serverSays({ t: "move", id: "a", x: 50, y: 60, frame: 1, anim: "walk-down", flip: false, depth: 60, room: "Kitchen" });
    sockets[0].serverSays({ t: "peer", id: "b", patch: { status: "focusing" } });
    expect(client.peers.get("a")).toMatchObject({ x: 50, y: 60, room: "Kitchen", anim: "walk-down" });
    expect(client.peers.get("b")?.status).toBe("focusing");

    sockets[0].serverSays({ t: "leave", id: "a" });
    expect([...client.peers.keys()]).toEqual(["b"]);
  });

  it("hands relayed voice/video frames to media listeners with the sender's id", () => {
    const frames: { kind: number; id: string; payload: number[] }[] = [];
    client.onMedia((f) => frames.push({ kind: f.kind, id: f.id, payload: [...f.payload] }));
    client.connect();
    const id = "a".repeat(24);
    const buf = new Uint8Array([1, ...[...id].map((c) => c.charCodeAt(0)), 7, 8, 9]);
    sockets[0].onmessage?.({ data: buf.buffer as unknown as string });
    expect(frames).toEqual([{ kind: 1, id, payload: [7, 8, 9] }]);
  });

  it("sends only while connected", () => {
    client.connect();
    client.send({ t: "voice", on: true });
    sockets[0].readyState = 0;
    client.send({ t: "voice", on: false });
    expect(sockets[0].sent).toEqual([{ t: "voice", on: true }]);
  });

  it("reconnects after the network drops, and forgets who was here", () => {
    const seen: ServerMsg[] = [];
    client.on((m) => seen.push(m));
    client.connect();
    sockets[0].serverSays({ t: "welcome", you: "me", peers: [peer("a", "Ana")], callRooms: [] });
    sockets[0].serverCloses(1006);
    expect(client.state).toBe("offline");
    expect(client.peers.size).toBe(0);
    expect(seen.at(-1)).toEqual({ t: "leave", id: "a" });
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2);
  });

  it("stays closed when another tab took over or the member is gone", () => {
    client.connect();
    sockets[0].serverCloses(CLOSE.replaced);
    expect(client.state).toBe("replaced");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    client.reconnect();
    expect(sockets).toHaveLength(2);
    sockets[1].serverCloses(CLOSE.gone);
    expect(client.state).toBe("gone");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });
});
