import type { LiveClient } from "./client";
import { isCaller, type SignalData } from "./protocol";

/**
 * STUN only (no TURN): pairs that can't connect directly use the server relay instead.
 * NEXT_PUBLIC_STUN_URLS: comma-separated STUN servers; "off" skips direct links (relay only).
 */
const STUN = process.env.NEXT_PUBLIC_STUN_URLS || "stun:stun.l.google.com:19302";
export const DIRECT_ENABLED = STUN.trim() !== "off";
const ICE: RTCIceServer[] = DIRECT_ENABLED
  ? [{ urls: STUN.split(",").map((s) => s.trim()).filter(Boolean) }]
  : [];

/** A link that isn't connected by now gives up; the relay carries that pair meanwhile. */
const CONNECT_TIMEOUT_MS = 6000;
/** After a failed attempt, wait this long before trying that pair directly again. */
const RETRY_AFTER_MS = 45_000;

export interface Link {
  id: string;
  peer: string;
  pc: RTCPeerConnection;
  remote: MediaStream | null;
  /** ICE candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
  openedAt: number;
}

/**
 * Direct WebRTC links for one purpose ("prox" voice or "call" video),
 * signalled over the live socket. One link per pair; the side with the smaller
 * member id sends the offer. `reconcile` opens and closes links to match what
 * should exist. Links that don't connect quickly are dropped and retried
 * later — the server relay covers that pair in the meantime.
 */
export class Mesh {
  readonly links = new Map<string, Link>();
  private local: MediaStream | null = null;
  private wanted = new Map<string, string>();
  private failed = new Map<string, number>();
  private off: () => void;

  constructor(
    private live: LiveClient,
    private prefix: "prox" | "call",
    /** Called when a link opens, connects, closes or gets remote media. */
    private onChange: () => void,
  ) {
    this.off = live.on((msg) => {
      if (msg.t === "signal" && msg.link.startsWith(`${prefix}:`)) void this.onSignal(msg.from, msg.link, msg.data);
      if (msg.t === "leave") for (const l of [...this.links.values()]) if (l.peer === msg.id) this.drop(l.id, false);
    });
  }

  /** The stream we send (mic for voice; camera + mic for calls). Changing it reconnects. */
  setLocal(stream: MediaStream | null) {
    if (stream === this.local) return;
    this.local = stream;
    for (const id of [...this.links.keys()]) this.drop(id, true);
    if (stream) this.reconcile(this.wanted);
  }

  /** Make the open links match `wanted` (link id → member id). */
  reconcile(wanted: Map<string, string>) {
    this.wanted = wanted;
    for (const id of [...this.links.keys()]) if (!wanted.has(id)) this.drop(id, true);
    const me = this.live.me;
    if (!this.local || !me || !DIRECT_ENABLED) return;
    const now = Date.now();
    for (const [id, link] of [...this.links]) {
      if (link.pc.connectionState !== "connected" && now - link.openedAt > CONNECT_TIMEOUT_MS) this.fail(id);
    }
    for (const [id, peer] of wanted) {
      if (this.links.has(id) || now - (this.failed.get(id) ?? 0) < RETRY_AFTER_MS) continue;
      if (isCaller(me, peer)) void this.call(id, peer);
    }
  }

  private fail(id: string) {
    this.failed.set(id, Date.now());
    this.drop(id, true);
  }

  private open(id: string, peer: string): Link {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const link: Link = { id, peer, pc, remote: null, pending: [], openedAt: Date.now() };
    this.links.set(id, link);
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      if (c) this.signal(peer, id, { kind: "ice", candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } });
    };
    pc.ontrack = (e) => {
      link.remote = e.streams[0] ?? new MediaStream([e.track]);
      this.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.fail(id);
      else if (pc.connectionState === "closed") this.drop(id, false);
      else this.onChange();
    };
    this.onChange();
    return link;
  }

  private async call(id: string, peer: string) {
    const link = this.open(id, peer);
    try {
      const offer = await link.pc.createOffer();
      await link.pc.setLocalDescription(offer);
      this.signal(peer, id, { kind: "offer", sdp: offer.sdp ?? "" });
    } catch (err) {
      console.error("[live] couldn't start a direct connection", err);
      this.fail(id);
    }
  }

  private async onSignal(from: string, id: string, data: SignalData) {
    if (data.kind === "bye") return this.drop(id, false);
    let link = this.links.get(id);
    try {
      if (data.kind === "offer") {
        // Only answer people we'd connect to ourselves (nearby, or in the same call).
        if (!this.local || this.wanted.get(id) !== from) return;
        if (link) this.drop(id, false);
        link = this.open(id, from);
        await link.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        await this.flush(link);
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        this.signal(from, id, { kind: "answer", sdp: answer.sdp ?? "" });
      } else if (data.kind === "answer") {
        if (!link || link.pc.signalingState !== "have-local-offer") return;
        await link.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        await this.flush(link);
      } else if (data.kind === "ice") {
        if (!link) return;
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(data.candidate);
        else link.pending.push(data.candidate);
      }
    } catch (err) {
      console.error("[live] direct connection setup failed — using the relay", err);
      this.fail(id);
    }
  }

  private async flush(link: Link) {
    for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => {});
  }

  private signal(to: string, link: string, data: SignalData) {
    this.live.send({ t: "signal", to, link, data });
  }

  private drop(id: string, tellThem: boolean) {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    if (tellThem) this.signal(link.peer, id, { kind: "bye" });
    link.pc.onicecandidate = link.pc.ontrack = link.pc.onconnectionstatechange = null;
    link.pc.close();
    this.onChange();
  }

  /** Links that are connected and carrying the other side's media. */
  connected() {
    return [...this.links.values()].filter((l) => l.pc.connectionState === "connected" && l.remote);
  }

  dispose() {
    this.off();
    for (const id of [...this.links.keys()]) this.drop(id, true);
    this.local = null;
  }
}
