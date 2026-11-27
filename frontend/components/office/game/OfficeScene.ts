import type * as P from "phaser";
import type { PreparedOffice } from "../prepare";
import { plateKey, rugKey, type Sheet } from "./assets";
import { onResize, setupCamera, setupMinimap } from "./camera";
import type { ArrangeState, GameBus } from "./events";
import { INTERACTIONS, type Interaction, type InteractionId } from "./interactions";
import { blocksTheWay, groupOf, isMovable, kindLabel, placementProblem, type FurnitureMeta, type FurnitureMove, type LayoutFloor } from "./layoutEdit";
import type { PlacedObject } from "./map";
import { PlayerController, createAvatarAnims, type SeatPose } from "./player";
import { RemoteAvatars } from "./remotes";
import { AVATAR_ANIMS, type AvatarAnim } from "../live/protocol";
import { seatFor, seatInteraction } from "./seating";
import { T, TILE } from "./tiles";

export interface OfficeSceneData {
  prepared: PreparedOffice;
  bus: GameBus;
  reducedMotion: boolean;
}

interface Target {
  id: InteractionId;
  interaction: Interaction;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pose: SeatPose;
}

const POSES: Partial<Record<PlacedObject["kind"], SeatPose>> = { "sofa-back": "back", "armchair-r": "right", "armchair-l": "left" };

/** How close (px) the player's feet must be to an object's footprint to interact. */
const REACH = 12;

/** Arrange mode: camera pan speed with the keys (world px/s) and how far a press may drift before it counts as a drag. */
const PAN_SPEED = 220;
const DRAG_SLOP = 6;
const TINT = { hover: 0xfff1a8, ok: 0xb9f0a8, bad: 0xff9a8a } as const;

/** Something drawn for an object, and where it was drawn for the saved layout. */
type Visual = { obj: P.GameObjects.Image | P.GameObjects.Sprite; x: number; y: number; depth: number; sorted: boolean };

/** A piece (with its companions) picked up in arrange mode. */
interface Held {
  group: number[];
  /** Where each piece of the group was when picked up. */
  from: { tx: number; ty: number }[];
  /** Pointer tile minus the lead piece's tile when picked up, so it doesn't jump under the cursor. */
  grab: { dx: number; dy: number };
  /** The lead piece's tile last checked, so pointer moves within a tile don't re-check. */
  spot: string;
  problem: string | null;
}

/** The Phaser scene class is built at runtime because Phaser is loaded lazily. */
export function createOfficeScene(Phaser: PreparedOffice["Phaser"]) {
  return class OfficeScene extends Phaser.Scene {
    private data_!: OfficeSceneData;
    private player!: PlayerController;
    private targets: Target[] = [];
    private current: Target | null = null;
    private myDesk: { x: number; y: number } | null = null;
    /** Where the player sits at their own desk, and where to stand when arriving from afar. */
    private myChair: { x: number; y: number; depth: number; front: { x: number; y: number } } | null = null;
    private room = "";
    private paused = false;
    private puffs: P.GameObjects.Image[] = [];
    private coffeeAt = { x: 0, y: 0 };
    private cleanup: (() => void)[] = [];
    private remotes!: RemoteAvatars;

    /* Arrange mode (owner): pick furniture up and put it down elsewhere. */
    private arranging = false;
    /** Objects as currently arranged (positions change; the saved map stays as loaded). */
    private working: PlacedObject[] = [];
    private visuals = new Map<number, Visual[]>();
    private held: Held | null = null;
    private hovered: number | null = null;
    private press: { x: number; y: number; scrollX: number; scrollY: number; dragging: boolean } | null = null;
    private panKeys: Record<"up" | "down" | "left" | "right", P.Input.Keyboard.Key[]> | null = null;
    /** Shown only outside arrange mode: they belong to the saved layout. */
    private layoutOnly: P.GameObjects.GameObject[] = [];

    constructor() {
      super("office");
    }

    init(data: OfficeSceneData) {
      this.data_ = data;
    }

    create() {
      const { prepared, bus, reducedMotion } = this.data_;
      const { map, art } = prepared;
      const worldW = map.width * TILE;
      const worldH = map.height * TILE;

      this.registerTextures(art.tiles, art.sheets, art.avatar);

      // Floor and walls in one tile layer; collisions on an invisible second layer.
      const tilemap = this.make.tilemap({ data: map.tiles, tileWidth: TILE, tileHeight: TILE });
      const tileset = tilemap.addTilesetImage("tiles", "tiles", TILE, TILE)!;
      tilemap.createLayer(0, tileset, 0, 0)!.setDepth(0);
      const blocked = tilemap.createBlankLayer("collision", tileset)!.setVisible(false);
      map.walls.forEach((row, y) => row.forEach((w, x) => w && blocked.putTileAt(T.BLOCK, x, y)));

      map.objects.forEach((o, i) => this.placeObject(o, i, blocked, reducedMotion));
      this.working = map.objects.map((o) => ({ ...o }));
      blocked.setCollision(T.BLOCK);
      // Shadows and light pools sit over the floor and rugs, under everything standing on it.
      this.textures.addCanvas("lighting", art.lighting);
      this.layoutOnly.push(this.add.image(0, 0, "lighting").setOrigin(0).setDepth(1.5));

      // Player
      createAvatarAnims(this);
      // Start where you left off if that spot is still free floor; otherwise at the door.
      const saved = prepared.config.position;
      const free = (x: number, y: number) => x > 0 && y > 0 && x < worldW && y < worldH && !blocked.getTileAtWorldXY(x, y - 3) && !map.walls[Math.floor((y - 3) / TILE)]?.[Math.floor(x / TILE)];
      const start = saved && free(saved.x, saved.y) ? saved : { x: map.spawn.tx * TILE, y: map.spawn.ty * TILE + TILE / 2 };
      this.player = new PlayerController(this, start.x, start.y);
      bus.positionOf = () => this.player.restPoint;
      this.physics.world.setBounds(0, 0, worldW, worldH);
      this.physics.add.collider(this.player.sprite, blocked);

      // Cameras
      const cam = setupCamera(this, this.player.sprite, worldW, worldH);
      const { mini, place } = setupMinimap(this, worldW, worldH);
      const marker = this.add.image(0, 0, "marker").setScale(4).setDepth(1e6);
      cam.ignore(marker);
      // Your desk: a bobbing arrow in the world and a marker on the minimap.
      if (this.myDesk && this.textures.exists("desk-marker") && this.textures.exists("desk-arrow")) {
        const { x: dx, y: dy } = this.myDesk;
        const deskMarker = this.add.image(dx, dy, "desk-marker").setScale(3).setDepth(1e6 - 1);
        const arrow = this.add.image(dx, dy - 30, "desk-arrow").setDepth(1e5);
        if (!reducedMotion) this.tweens.add({ targets: arrow, y: arrow.y - 3, duration: 600, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        cam.ignore(deskMarker);
        mini.ignore(arrow);
        this.layoutOnly.push(deskMarker, arrow);
      }
      // Teammates in the office right now (the page re-sends everyone once the scene is ready).
      this.remotes = new RemoteAvatars(this, cam);
      bus.poseOf = () => this.pose();
      this.events.on("postupdate", () => marker.setPosition(this.player.sprite.x, this.player.sprite.y - 8));
      this.events.on("render", () => this.emitAnchor());
      this.cleanup.push(onResize(this, place));

      // Coffee steam, created once and reused.
      this.puffs = Array.from({ length: 6 }, () => this.add.image(0, 0, "puff").setVisible(false).setDepth(1e5));

      // Keyboard interaction and the UI bridge.
      this.input.keyboard!.on("keydown-E", () => this.interact());
      this.input.keyboard!.on("keydown-ESC", () => this.held && this.putBack());
      const kb = this.input.keyboard!;
      this.panKeys = {
        up: [kb.addKey("W"), kb.addKey("UP")],
        down: [kb.addKey("S"), kb.addKey("DOWN")],
        left: [kb.addKey("A"), kb.addKey("LEFT")],
        right: [kb.addKey("D"), kb.addKey("RIGHT")],
      };
      this.input.on("pointerdown", (p: P.Input.Pointer) => this.onPointerDown(p));
      this.input.on("pointermove", (p: P.Input.Pointer) => this.onPointerMove(p));
      this.input.on("pointerup", (p: P.Input.Pointer) => this.onPointerUp(p));
      bus.arrangeMoves = () => this.moves();
      this.cleanup.push(
        bus.on("request-interact", () => this.interact()),
        bus.on("set-paused", (p) => this.setPaused(p)),
        bus.on("set-minimap", (on) => mini.setVisible(on)),
        bus.on("set-arrange", (on) => this.setArranging(on)),
        bus.on("peer-upsert", (peer) => this.remotes.upsert(peer)),
        bus.on("peer-move", ({ id, ...pose }) => this.remotes.move(id, pose)),
        bus.on("peer-leave", (id) => this.remotes.remove(id)),
        bus.on("arrange-saved", () => this.endArranging(false)),
        bus.on("set-status", (status) => {
          if (status === "focusing") this.goToDesk();
          else if (status === "available") this.player.standUp();
          else if (this.atDesk()) this.player.standUp();
        }),
      );
      // Destroying the game fires "destroy" (not "shutdown"), so unsubscribe on both.
      const teardown = () => {
        if (bus.positionOf) bus.positionOf = null;
        bus.poseOf = null;
        this.remotes.destroy();
        bus.arrangeMoves = null;
        this.cleanup.forEach((fn) => fn());
        this.cleanup = [];
      };
      this.events.once("shutdown", teardown);
      this.events.once("destroy", teardown);

      bus.emit("ready");
    }

    private registerTextures(tiles: Sheet, sheets: Record<string, Sheet>, avatar: Sheet) {
      const add = (key: string, s: Sheet) => {
        const tex = this.textures.addCanvas(key, s.canvas)!;
        for (let i = 0; i < s.count; i++) tex.add(i, 0, i * s.frameW, 0, s.frameW, s.frameH);
        if (s.count > 1 && s.fps) {
          this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end: s.count - 1 }), frameRate: s.fps, repeat: -1 });
        }
      };
      this.textures.addCanvas("tiles", tiles.canvas);
      for (const [key, s] of Object.entries(sheets)) add(key, s);
      add("avatar", avatar);
    }

    private placeObject(o: PlacedObject, index: number, blocked: P.Tilemaps.TilemapLayer, reducedMotion: boolean) {
      const { art } = this.data_.prepared;
      const meta = art.meta[o.kind];
      const key = o.kind === "rug" ? rugKey(o.w!, o.h!) : o.kind;
      const sheet = art.sheets[key];
      const fw = meta.footprint?.w ?? o.w ?? 1;
      const fh = meta.footprint?.h ?? 1;
      const x = o.tx * TILE + Math.round((fw * TILE - sheet.frameW) / 2);
      const bottom = (o.ty + 1) * TILE;

      let img: P.GameObjects.Sprite;
      if (meta.layer === "floor") {
        const top = o.kind === "rug" ? (o.ty - o.h! + 1) * TILE : bottom - sheet.frameH;
        img = this.add.sprite(o.kind === "rug" ? o.tx * TILE : x, top, key, o.frame ?? 0).setOrigin(0).setDepth(1);
      } else if (meta.layer === "wall") {
        const top = o.ty * TILE + Math.max(-4, Math.round((13 - sheet.frameH) / 2));
        img = this.add.sprite(x, top, key, o.frame ?? 0).setOrigin(0).setDepth(2);
      } else {
        img = this.add.sprite(x, bottom, key, o.frame ?? 0).setOrigin(0, 1).setDepth(bottom);
      }
      const drawn: Visual[] = [{ obj: img, x: img.x, y: img.y, depth: img.depth, sorted: meta.layer === "sort" }];
      this.visuals.set(index, drawn);
      if (this.anims.exists(key) && !reducedMotion) {
        img.play({ key, startFrame: (o.tx + o.ty) % sheet.count });
      }

      if (meta.footprint) {
        for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) blocked.putTileAt(T.BLOCK, o.tx + i, o.ty - j);
      }
      // Team desks get a nameplate on their front and say whose desk they are.
      let interaction: Interaction | undefined = o.interact && INTERACTIONS[o.interact];
      if (o.desk !== undefined && this.textures.exists(plateKey(o.desk))) {
        const cx = o.tx * TILE + TILE;
        const plate = this.add.image(cx, bottom - 1, plateKey(o.desk)).setOrigin(0.5, 1).setDepth(bottom + 0.5);
        drawn.push({ obj: plate, x: plate.x, y: plate.y, depth: plate.depth, sorted: true });
        const seat = seatFor(this.data_.prepared.config, o.desk);
        interaction = seatInteraction(seat);
        // Your desk is the one saved for you (desk 1 in offices built on this device).
        if (seat.kind === "mine") {
          this.myDesk = { x: cx, y: bottom - 8 };
          this.myChair = { x: cx, y: o.ty * TILE + 1, depth: bottom - 0.5, front: { x: cx, y: bottom + 12 } };
        }
      }
      if (o.interact && interaction) {
        this.targets.push({ id: o.interact, interaction, x0: o.tx * TILE, y0: (o.ty - fh + 1) * TILE, x1: (o.tx + fw) * TILE, y1: bottom, pose: POSES[o.kind] ?? "front" });
      }
      if (o.interact === "coffee") this.coffeeAt = { x: x + 8, y: bottom - 22 };
    }

    private setPaused(p: boolean) {
      this.paused = p;
      const kb = this.input.keyboard;
      if (!kb?.manager) return; // game already torn down
      kb.resetKeys();
      // Let overlays use the keyboard normally while they are open.
      if (p) kb.disableGlobalCapture();
      else kb.enableGlobalCapture();
    }

    private interact() {
      if (this.paused || !this.current) return;
      const { id, interaction } = this.current;
      if (interaction.action === "coffee") this.brew();
      if (interaction.action === "break" && !this.player.seated) this.sitOn(this.current);
      this.data_.bus.emit("interact", { id, interaction });
    }

    /** Sit on a sofa, armchair or beanbag: the seat nearest the player, facing the way the seat does. */
    private sitOn(t: Target) {
      const { x, y } = this.player.sprite;
      const seats = [];
      for (let sx = t.x0 + TILE / 2; sx < t.x1; sx += TILE) seats.push(sx);
      const seatX = seats.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
      // Behind a sofa back or an armrest, the seat is drawn over the player.
      if (t.pose === "back") this.player.sit(seatX, t.y1 - 5, t.y1 - 0.5, { x, y }, false, "back");
      else if (t.pose === "left" || t.pose === "right") this.player.sit(seatX + (t.pose === "right" ? 2 : -2), t.y1 - 5, t.y1 - 0.5, { x, y }, false, t.pose);
      else this.player.sit(seatX, t.y1 - 1, t.y1 + 0.5, { x, y }, false);
    }

    private atDesk() {
      const s = this.player.sprite;
      return this.player.seated && !!this.myChair && s.x === this.myChair.x && s.y === this.myChair.y;
    }

    /** Sit at your own desk, fading over if you're elsewhere in the office. */
    private goToDesk() {
      const chair = this.myChair;
      if (!chair) return;
      const s = this.player.sprite;
      if (this.atDesk()) return;
      const near = !this.player.seated && Math.hypot(s.x - chair.front.x, s.y - chair.front.y) < 56;
      const sit = () => this.player.sit(chair.x, chair.y, chair.depth, near ? { x: s.x, y: s.y } : chair.front, true);
      const cam = this.cameras.main;
      if (near || this.data_.reducedMotion) return sit();
      cam.fadeOut(160, 43, 42, 34);
      cam.once("camerafadeoutcomplete", () => {
        sit();
        cam.fadeIn(200, 43, 42, 34);
      });
    }

    private brew() {
      if (this.data_.reducedMotion) return;
      this.puffs.forEach((p, i) => {
        this.tweens.killTweensOf(p);
        p.setPosition(this.coffeeAt.x + (i % 3) * 2 - 2, this.coffeeAt.y).setAlpha(0).setVisible(true);
        this.tweens.add({
          targets: p,
          y: this.coffeeAt.y - 14,
          alpha: { from: 0.9, to: 0 },
          delay: i * 180,
          duration: 1100,
          onComplete: () => p.setVisible(false),
        });
      });
    }

    /* ------------------------------ Arrange mode ----------------------------- */

    private get meta() {
      return this.data_.prepared.art.meta as FurnitureMeta;
    }

    private floor(objects: PlacedObject[]): LayoutFloor {
      const { map } = this.data_.prepared;
      return { width: map.width, height: map.height, walls: map.walls, spawn: map.spawn, objects };
    }

    private setArranging(on: boolean) {
      if (on === this.arranging) return;
      if (!on) return this.endArranging(true);
      this.arranging = true;
      this.current = null;
      this.data_.bus.emit("prompt", null);
      this.cameras.main.stopFollow();
      // Light pools and the desk arrow belong to the saved layout; hide them while things move.
      this.layoutOnly.forEach((o) => (o as P.GameObjects.Image).setVisible(false));
      this.input.keyboard?.enableGlobalCapture();
      this.report(null);
    }

    /** Leave arrange mode; `restore` puts every unsaved move back. */
    private endArranging(restore: boolean) {
      if (!this.arranging) return;
      this.held = null;
      this.press = null;
      this.setHover(null);
      if (restore) {
        this.working = this.data_.prepared.map.objects.map((o) => ({ ...o }));
        this.visuals.forEach((_, i) => this.sync(i));
        this.layoutOnly.forEach((o) => (o as P.GameObjects.Image).setVisible(true));
      }
      this.arranging = false;
      this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
      this.report(null);
    }

    /** Furniture that differs from the saved layout. */
    private moves(): FurnitureMove[] {
      const saved = this.data_.prepared.map.objects;
      return this.working.flatMap((o, index) => {
        const s = saved[index];
        return s.tx === o.tx && s.ty === o.ty ? [] : [{ index, kind: o.kind, from: { tx: s.tx, ty: s.ty }, to: { tx: o.tx, ty: o.ty } }];
      });
    }

    private report(problem: string | null) {
      // Count pieces the owner moved, not the chairs that came along with desks.
      const moved = new Set(this.moves().map((m) => groupOf(this.working, m.index)[0])).size;
      const holding = this.held ? kindLabel(this.working[this.held.group[0]].kind) : null;
      const state: ArrangeState = { moved, holding, problem };
      this.data_.bus.emit("arrange", state);
    }

    /** Draw object `i` where `working` says it is now. */
    private sync(i: number) {
      const saved = this.data_.prepared.map.objects[i];
      const now = this.working[i];
      const dx = (now.tx - saved.tx) * TILE;
      const dy = (now.ty - saved.ty) * TILE;
      for (const v of this.visuals.get(i) ?? []) {
        v.obj.setPosition(v.x + dx, v.y + dy);
        if (v.sorted) v.obj.setDepth(v.depth + dy);
      }
    }

    private tint(group: number[], color: number | null) {
      for (const i of group) {
        for (const v of this.visuals.get(i) ?? []) {
          if (color === null) v.obj.clearTint();
          else v.obj.setTint(color);
        }
      }
    }

    private setHover(i: number | null) {
      if (i === this.hovered) return;
      if (this.hovered !== null) this.tint(groupOf(this.working, this.hovered), null);
      this.hovered = i;
      if (i !== null) this.tint(groupOf(this.working, i), TINT.hover);
    }

    private worldAt(p: { x: number; y: number }) {
      return this.cameras.main.getWorldPoint(p.x, p.y);
    }

    private pointerTile() {
      const w = this.worldAt(this.input.activePointer);
      return { tx: Math.floor(w.x / TILE), ty: Math.floor(w.y / TILE) };
    }

    /** The movable piece drawn under a screen point (the one in front wins). */
    private pieceAt(p: { x: number; y: number }): number | null {
      const w = this.worldAt(p);
      let best: number | null = null;
      let bestDepth = -Infinity;
      for (const [i, vs] of this.visuals) {
        const img = vs[0].obj;
        if (!isMovable(this.working[i], this.meta) || !img.getBounds().contains(w.x, w.y)) continue;
        if (img.depth > bestDepth) {
          best = i;
          bestDepth = img.depth;
        }
      }
      return best;
    }

    private pickUp(i: number, at: { tx: number; ty: number }) {
      const group = groupOf(this.working, i);
      const lead = this.working[group[0]];
      this.setHover(null);
      this.held = {
        group,
        from: group.map((g) => ({ tx: this.working[g].tx, ty: this.working[g].ty })),
        grab: { dx: at.tx - lead.tx, dy: at.ty - lead.ty },
        spot: "",
        problem: null,
      };
      this.follow(at);
    }

    /** Move what's in hand so the lead piece sits under tile `at` (keeping the grab offset), and check the spot. */
    private follow(at: { tx: number; ty: number }) {
      const held = this.held;
      if (!held) return;
      const lead = held.from[0];
      const tx = at.tx - held.grab.dx;
      const ty = at.ty - held.grab.dy;
      if (held.spot === `${tx},${ty}`) return;
      held.spot = `${tx},${ty}`;
      const dx = tx - lead.tx;
      const dy = ty - lead.ty;
      held.group.forEach((g, k) => {
        this.working[g] = { ...this.working[g], tx: held.from[k].tx + dx, ty: held.from[k].ty + dy };
        this.sync(g);
      });
      held.problem = this.problemHere(held.group);
      this.tint(held.group, held.problem ? TINT.bad : TINT.ok);
      this.report(held.problem);
    }

    private problemHere(group: number[]) {
      const next = this.floor(this.working);
      return placementProblem(next, group, this.meta) ?? blocksTheWay(this.floor(this.data_.prepared.map.objects), next, this.meta);
    }

    /** Put what's in hand down here, if the spot is fine. */
    private drop() {
      const held = this.held;
      if (!held) return;
      if (held.problem) return this.report(held.problem);
      this.tint(held.group, null);
      this.held = null;
      this.report(null);
    }

    /** Escape: return what's in hand to where it was picked up. */
    private putBack() {
      const held = this.held;
      if (!held) return;
      held.group.forEach((g, k) => {
        this.working[g] = { ...this.working[g], ...held.from[k] };
        this.sync(g);
      });
      this.tint(held.group, null);
      this.held = null;
      this.report(null);
    }

    private onPointerDown(p: P.Input.Pointer) {
      if (!this.arranging || this.paused) return;
      const cam = this.cameras.main;
      this.press = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY, dragging: false };
    }

    private onPointerMove(p: P.Input.Pointer) {
      if (!this.arranging || this.paused) return;
      const press = this.press;
      // Dragging empty floor pans the camera (handy on touch screens).
      if (press && p.isDown && !this.held) {
        if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) > DRAG_SLOP) press.dragging = true;
        if (press.dragging) {
          const cam = this.cameras.main;
          cam.setScroll(press.scrollX - (p.x - press.x) / cam.zoom, press.scrollY - (p.y - press.y) / cam.zoom);
        }
        return;
      }
      if (this.held) return this.follow(this.pointerTile());
      this.setHover(this.pieceAt(p));
    }

    private onPointerUp(p: P.Input.Pointer) {
      if (!this.arranging || this.paused) return;
      const dragged = this.press?.dragging;
      this.press = null;
      if (dragged) return;
      if (this.held) {
        this.follow(this.pointerTile());
        return this.drop();
      }
      const i = this.pieceAt(p);
      if (i !== null) this.pickUp(i, this.pointerTile());
    }

    /** Arrow keys / WASD move the camera instead of the avatar while arranging. */
    private pan(delta: number) {
      const keys = this.panKeys;
      if (!keys || this.paused) return;
      const held = (d: keyof typeof keys) => keys[d].some((k) => k.isDown);
      const dx = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
      const dy = (held("down") ? 1 : 0) - (held("up") ? 1 : 0);
      if (!dx && !dy) return;
      const cam = this.cameras.main;
      const step = (PAN_SPEED * delta) / 1000;
      cam.setScroll(cam.scrollX + dx * step, cam.scrollY + dy * step);
      if (this.held) this.follow(this.pointerTile());
    }

    /** Nearest interactive object within reach of the player's feet. */
    private nearest(px: number, py: number): Target | null {
      let best: Target | null = null;
      let bestD = REACH;
      for (const t of this.targets) {
        const dx = Math.max(t.x0 - px, 0, px - t.x1);
        const dy = Math.max(t.y0 - py, 0, py - t.y1);
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      return best;
    }

    update(_time: number, delta: number) {
      const { bus, prepared } = this.data_;
      this.remotes.update(delta);
      if (this.arranging) {
        this.player.update(false);
        this.pan(delta);
        return;
      }
      if (this.player.update(!this.paused)) bus.emit("stood");
      const { x, y } = this.player.feet;

      const near = this.paused ? null : this.nearest(x, y);
      if (near !== this.current) {
        this.current = near;
        bus.emit("prompt", near ? { id: near.id, interaction: near.interaction } : null);
      }

      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      const room = prepared.map.rooms.find((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
      if (room && room.name !== this.room) {
        this.room = room.name;
        bus.emit("room", room.name);
      }
    }

    /** Head position in canvas pixels for the DOM name tag and prompt, after the camera has moved. */
    private emitAnchor() {
      const cam = this.cameras.main;
      const s = this.player.sprite;
      const { bus } = this.data_;
      bus.onAnchor?.((s.x - cam.worldView.x) * cam.zoom, (s.y - s.height - cam.worldView.y) * cam.zoom);
      if (bus.onPeerAnchor) this.remotes.anchors(bus.onPeerAnchor);
    }

    /** How the player looks right now, for teammates' screens. */
    private pose() {
      const s = this.player.sprite;
      const key = s.anims.isPlaying ? s.anims.currentAnim?.key : undefined;
      const anim = key && (AVATAR_ANIMS as readonly string[]).includes(key) ? (key as AvatarAnim) : null;
      return { x: Math.round(s.x), y: Math.round(s.y), frame: Number(s.frame.name) || 0, anim, flip: s.flipX, depth: s.depth, room: this.room };
    }
  };
}
