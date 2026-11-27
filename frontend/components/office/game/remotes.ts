import type * as P from "phaser";
import type { PeerView, Pose } from "../live/protocol";
import { avatarSheet } from "./assets";
import { createAvatarAnims } from "./player";

/** Further than this (px) and a teammate jumps instead of gliding (they reconnected or sat down across the room). */
const SNAP = 64;
/** How quickly a remote avatar catches up with the last position heard (per second). */
const FOLLOW = 14;

type Remote = { sprite: P.GameObjects.Sprite; marker: P.GameObjects.Image; avatarId: string; target: Pose };

/**
 * Teammates' avatars. Positions arrive ~10 times a second over the live
 * socket; each avatar glides towards the latest one and mirrors the frame or
 * animation the teammate's own screen shows. No physics: they never block you.
 */
export class RemoteAvatars {
  private remotes = new Map<string, Remote>();

  constructor(
    private scene: P.Scene,
    private mainCam: P.Cameras.Scene2D.Camera,
  ) {}

  /** Texture and animations for an avatar, made the first time someone wears it. */
  private ensureAvatar(avatarId: string) {
    const key = `avatar@${avatarId}`;
    if (this.scene.textures.exists(key)) return key;
    const s = avatarSheet(avatarId);
    const tex = this.scene.textures.addCanvas(key, s.canvas)!;
    for (let i = 0; i < s.count; i++) tex.add(i, 0, i * s.frameW, 0, s.frameW, s.frameH);
    createAvatarAnims(this.scene, key, `@${avatarId}`);
    return key;
  }

  upsert(peer: PeerView) {
    const existing = this.remotes.get(peer.id);
    if (existing) {
      if (existing.avatarId !== peer.avatarId) this.setAvatar(peer.id, peer.avatarId);
      return this.move(peer.id, peer);
    }
    const key = this.ensureAvatar(peer.avatarId);
    const sprite = this.scene.add.sprite(peer.x, peer.y, key, peer.frame).setOrigin(0.5, 1).setDepth(peer.depth);
    const marker = this.scene.add.image(peer.x, peer.y - 8, "peer-marker").setScale(4).setDepth(1e6 - 2);
    // The marker is for the minimap only.
    this.mainCam.ignore(marker);
    const r: Remote = { sprite, marker, avatarId: peer.avatarId, target: { ...peer } };
    this.remotes.set(peer.id, r);
    this.show(r);
  }

  move(id: string, pose: Pose) {
    const r = this.remotes.get(id);
    if (!r) return;
    const animChanged = r.target.anim !== pose.anim || r.target.frame !== pose.frame || r.target.flip !== pose.flip;
    r.target = { x: pose.x, y: pose.y, frame: pose.frame, anim: pose.anim, flip: pose.flip, depth: pose.depth };
    if (Math.hypot(r.sprite.x - pose.x, r.sprite.y - pose.y) > SNAP) r.sprite.setPosition(pose.x, pose.y);
    if (animChanged) this.show(r);
  }

  setAvatar(id: string, avatarId: string) {
    const r = this.remotes.get(id);
    if (!r || r.avatarId === avatarId) return;
    r.avatarId = avatarId;
    r.sprite.setTexture(this.ensureAvatar(avatarId), r.target.frame);
    this.show(r);
  }

  remove(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.sprite.destroy();
    r.marker.destroy();
    this.remotes.delete(id);
  }

  private show(r: Remote) {
    const { anim, frame, flip } = r.target;
    if (anim) r.sprite.anims.play(`${anim}@${r.avatarId}`, true);
    else {
      r.sprite.anims.stop();
      r.sprite.setFrame(frame);
    }
    r.sprite.setFlipX(flip);
  }

  update(delta: number) {
    const k = 1 - Math.exp((-FOLLOW * delta) / 1000);
    for (const r of this.remotes.values()) {
      const s = r.sprite;
      const { x, y, depth } = r.target;
      s.setPosition(Math.abs(x - s.x) < 0.5 ? x : s.x + (x - s.x) * k, Math.abs(y - s.y) < 0.5 ? y : s.y + (y - s.y) * k);
      // Standing avatars sort by their feet; seated ones use the depth their own screen uses.
      s.setDepth(depth + (s.y - y));
      r.marker.setPosition(s.x, s.y - 8);
    }
  }

  /** Head position of each teammate in canvas pixels, for their DOM name tags. */
  anchors(fn: (id: string, x: number, y: number) => void) {
    const cam = this.mainCam;
    for (const [id, r] of this.remotes) {
      const s = r.sprite;
      fn(id, (s.x - cam.worldView.x) * cam.zoom, (s.y - s.height - cam.worldView.y) * cam.zoom);
    }
  }

  destroy() {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}
