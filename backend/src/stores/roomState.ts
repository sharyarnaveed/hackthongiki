/**
 * Watch-together room state. The video reference is encrypted by the client;
 * playback fields stay in the clear so late joiners can be synced.
 * In-memory for now; swap for Redis without changing callers.
 */
export interface EncryptedRef {
  ciphertext: string;
  iv: string;
}

export interface WatchRoomState {
  videoRef: EncryptedRef | null;
  playing: boolean;
  /** Playback position in seconds at `updatedAt`. */
  position: number;
  /** Server time (ms) when the state was last changed. */
  updatedAt: number;
  /** User who made the last change. */
  updatedBy: string | null;
}

export interface RoomStateStore {
  get(roomId: string): Promise<WatchRoomState | null>;
  set(roomId: string, state: WatchRoomState): Promise<void>;
  /** Merge a patch into the current (or default) state, stamping `updatedAt`. */
  patch(roomId: string, patch: Partial<Omit<WatchRoomState, 'updatedAt'>>): Promise<WatchRoomState>;
  delete(roomId: string): Promise<void>;
}

export const emptyWatchState = (): WatchRoomState => ({
  videoRef: null,
  playing: false,
  position: 0,
  updatedAt: Date.now(),
  updatedBy: null,
});

/**
 * Where playback is "now", given a stored state: if playing, advance the
 * position by elapsed time since the last update.
 */
export function currentPosition(state: WatchRoomState, now = Date.now()): number {
  if (!state.playing) return state.position;
  return state.position + Math.max(0, now - state.updatedAt) / 1000;
}

export class InMemoryRoomStateStore implements RoomStateStore {
  private readonly rooms = new Map<string, WatchRoomState>();

  async get(roomId: string): Promise<WatchRoomState | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async set(roomId: string, state: WatchRoomState): Promise<void> {
    this.rooms.set(roomId, { ...state });
  }

  async patch(roomId: string, patch: Partial<Omit<WatchRoomState, 'updatedAt'>>): Promise<WatchRoomState> {
    const next: WatchRoomState = { ...(this.rooms.get(roomId) ?? emptyWatchState()), ...patch, updatedAt: Date.now() };
    this.rooms.set(roomId, next);
    return next;
  }

  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }
}
