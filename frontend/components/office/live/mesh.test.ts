import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveClient } from "./client";
import { Mesh } from "./mesh";
import { proxLink } from "./protocol";

/** Just enough RTCPeerConnection to see what a link asks for. */
class FakePC {
  static all: FakePC[] = [];
  transceivers: { kind: string; direction: string }[] = [];
  tracks: unknown[] = [];
  connectionState = "new";
  signalingState = "stable";
  onicecandidate = null;
  ontrack = null;
  onconnectionstatechange = null;
  constructor() {
    FakePC.all.push(this);
  }
  addTransceiver(kind: string, init: { direction: string }) {
    this.transceivers.push({ kind, direction: init.direction });
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0" };
  }
  async setLocalDescription() {
    this.signalingState = "have-local-offer";
  }
  close() {}
}

function fakeLive(me: string) {
  const sent: { t: string; to?: string; link?: string; data?: { kind: string } }[] = [];
  const live = { me, on: () => () => {}, send: (m: (typeof sent)[number]) => sent.push(m) } as unknown as LiveClient;
  return { live, sent };
}

beforeEach(() => {
  FakePC.all = [];
  vi.stubGlobal("RTCPeerConnection", FakePC);
});
afterEach(() => vi.unstubAllGlobals());

describe("Mesh listen-only (hear nearby voices with the mic off)", () => {
  it("opens a receive-only link without a mic when listenOnly is on", async () => {
    const { live, sent } = fakeLive("a");
    const mesh = new Mesh(live, "prox", () => {}, true);
    mesh.reconcile(new Map([[proxLink("a", "b"), "b"]]));
    await vi.waitFor(() => expect(sent.some((m) => m.data?.kind === "offer")).toBe(true));

    expect(FakePC.all).toHaveLength(1);
    expect(FakePC.all[0].tracks).toHaveLength(0);
    expect(FakePC.all[0].transceivers).toEqual([{ kind: "audio", direction: "recvonly" }]);
  });

  it("opens nothing without a mic when listenOnly is off (calls)", () => {
    const { live, sent } = fakeLive("a");
    const mesh = new Mesh(live, "call", () => {});
    mesh.reconcile(new Map([["call:a:b:Meeting", "b"]]));
    expect(FakePC.all).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});
