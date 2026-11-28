import type { Interaction, InteractionId } from "./interactions";
import type { FurnitureMove } from "./layoutEdit";
import type { PeerView, Pose } from "../live/protocol";

/**
 * Typed bridge between the Phaser scene and the React HUD. Neither side
 * imports the other; they only share this bus. High-frequency data (the
 * player's screen position) goes through `onAnchor` and is written straight
 * to the DOM, never through React state.
 */
export interface GameEvents {
  /** Game → UI */
  ready: void;
  prompt: { id: InteractionId; interaction: Interaction } | null;
  room: string;
  interact: { id: InteractionId; interaction: Interaction };
  /** The player got up from a seat by moving. */
  stood: void;
  /** Arrange mode: how many pieces moved, what's in hand and why it can't go down here. */
  arrange: ArrangeState;
  /** UI → game */
  "request-interact": void;
  "set-paused": boolean;
  "set-minimap": boolean;
  /** Focusing sits the player at their desk; Available gets them up. */
  "set-status": PlayerStatus;
  /** Owner: start moving furniture (true), or stop and put everything back (false). */
  "set-arrange": boolean;
  /** The moved layout was saved: leave arrange mode as it is while the new office loads. */
  "arrange-saved": void;
  /** Walk the player straight into a room (joining a video call from anywhere in the office). */
  "go-to-room": string;
  /** Live office: a teammate appeared or changed avatar, moved, or left. */
  "peer-upsert": PeerView;
  "peer-move": Pose & { id: string };
  "peer-leave": string;
}

export type ArrangeState = { moved: number; holding: string | null; problem: string | null };

export type PlayerStatus = "available" | "focusing" | "break";

type Handler<T> = (payload: T) => void;

export class GameBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  /** Called every frame with the player's head position in canvas pixels. */
  onAnchor: ((x: number, y: number) => void) | null = null;

  setAnchor(fn: ((x: number, y: number) => void) | null) {
    this.onAnchor = fn;
  }

  /** Set by the scene: where the player stands (feet, world pixels; the spot in front of a seat while seated). */
  positionOf: (() => { x: number; y: number } | null) | null = null;

  /** Set by the scene: how the player is drawn right now and the room they're in, sent to teammates. */
  poseOf: (() => Pose & { room: string }) | null = null;

  /** Called every frame with each teammate's head position in canvas pixels (for their name tags). */
  onPeerAnchor: ((id: string, x: number, y: number) => void) | null = null;

  /** Set by the scene: the furniture moved so far in arrange mode. */
  arrangeMoves: (() => FurnitureMove[]) | null = null;

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn as Handler<never>);
    return () => void this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, ...payload: GameEvents[K] extends void ? [] : [GameEvents[K]]) {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<unknown>)(payload[0]));
  }
}
