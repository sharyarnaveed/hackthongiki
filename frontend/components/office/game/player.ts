import type * as P from "phaser";
import { AVATAR_ORDER, FRAMES_PER_FACING, SIT_FRAME } from "./assets";
import { AVATAR_H, type Facing } from "./avatar";

const SPEED = 84; // px/s ≈ 5 tiles a second
type Dir = "up" | "down" | "left" | "right";

/** Register idle/walk animations for each facing on the "avatar" texture. */
export function createAvatarAnims(scene: P.Scene, texture = "avatar", suffix = "") {
  AVATAR_ORDER.forEach((facing, i) => {
    const base = i * FRAMES_PER_FACING;
    scene.anims.create({
      key: `walk-${facing}${suffix}`,
      frames: [1, 2, 3, 4].map((n) => ({ key: texture, frame: base + n })),
      frameRate: 8,
      repeat: -1,
    });
  });
  scene.anims.create({ key: `sit-type${suffix}`, frames: [0, 1].map((n) => ({ key: texture, frame: SIT_FRAME + n })), frameRate: 3, repeat: -1 });
}

type Point = { x: number; y: number };

/** Which way a seat faces the viewer: towards (front), away (back), or in profile. */
export type SeatPose = "front" | "back" | "left" | "right";

/**
 * Top-down movement with WASD and arrow keys. Diagonals are normalised so
 * they are no faster than straight lines. The physics body covers only the
 * feet, so the avatar can stand in front of furniture and walk behind it.
 */
export class PlayerController {
  readonly sprite: P.Physics.Arcade.Sprite;
  private keys: Record<Dir, P.Input.Keyboard.Key[]>;
  private facing: Facing = "up";
  private left = false;
  /** Where to stand again when getting up; null while standing. */
  private seat: { stand: Point } | null = null;

  constructor(scene: P.Scene, x: number, y: number) {
    this.sprite = scene.physics.add.sprite(x, y, "avatar", FRAMES_PER_FACING).setOrigin(0.5, 1);
    const body = this.sprite.body as P.Physics.Arcade.Body;
    body.setSize(10, 5).setOffset(3, AVATAR_H - 5);
    this.sprite.setCollideWorldBounds(true);

    const kb = scene.input.keyboard!;
    const k = (code: string) => kb.addKey(code);
    this.keys = {
      up: [k("W"), k("UP")],
      down: [k("S"), k("DOWN")],
      left: [k("A"), k("LEFT")],
      right: [k("D"), k("RIGHT")],
    };
  }

  /** Feet position: the point used for rooms and interactions. */
  get feet() {
    return { x: this.sprite.x, y: this.sprite.y - 3 };
  }

  get seated() {
    return this.seat !== null;
  }

  /** Where to stand on the next visit: here, or in front of the seat while sitting. */
  get restPoint() {
    return this.seat ? { ...this.seat.stand } : { x: this.sprite.x, y: this.sprite.y };
  }

  /**
   * Sit with the feet at (x, y). `typing` plays the desk animation; otherwise
   * a still seated pose. The physics body is switched off while seated.
   */
  sit(x: number, y: number, depth: number, stand: Point, typing: boolean, pose: SeatPose = "front") {
    const body = this.sprite.body as P.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.enable = false;
    this.seat = { stand };
    this.sprite.setPosition(x, y).setDepth(depth).setFlipX(false);
    if (typing) this.sprite.anims.play("sit-type", true);
    else {
      this.sprite.anims.stop();
      // Seats facing away or sideways show the matching standing frame; the furniture hides the legs.
      if (pose === "back") this.sprite.setFrame(AVATAR_ORDER.indexOf("up") * FRAMES_PER_FACING);
      else if (pose === "left" || pose === "right") this.sprite.setFrame(AVATAR_ORDER.indexOf("side") * FRAMES_PER_FACING).setFlipX(pose === "left");
      else this.sprite.setFrame(SIT_FRAME);
    }
  }

  standUp() {
    if (!this.seat) return;
    const { x, y } = this.seat.stand;
    this.seat = null;
    this.facing = "down";
    const body = this.sprite.body as P.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
  }

  /** Returns true when a movement key made the player get up from a seat. */
  update(enabled: boolean): boolean {
    const held = (d: Dir) => enabled && this.keys[d].some((key) => key.isDown);
    if (this.seat) {
      if (!(held("up") || held("down") || held("left") || held("right"))) return false;
      this.standUp();
      return true;
    }
    const dx = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
    const dy = (held("down") ? 1 : 0) - (held("up") ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    this.sprite.setVelocity((dx / len) * SPEED, (dy / len) * SPEED);

    if (dx || dy) {
      // Keep the current facing on diagonals when it still matches one axis.
      const keepVertical = (dy < 0 && this.facing === "up") || (dy > 0 && this.facing === "down");
      const keepSide = dx !== 0 && this.facing === "side";
      if (!(keepVertical || keepSide)) this.facing = dx ? "side" : dy < 0 ? "up" : "down";
      if (dx) this.left = dx < 0;
      this.sprite.anims.play(`walk-${this.facing}`, true);
    } else {
      this.sprite.anims.stop();
      this.sprite.setFrame(AVATAR_ORDER.indexOf(this.facing) * FRAMES_PER_FACING);
    }
    this.sprite.setFlipX(this.facing === "side" && this.left);
    this.sprite.setDepth(this.sprite.y);
    return false;
  }
}
