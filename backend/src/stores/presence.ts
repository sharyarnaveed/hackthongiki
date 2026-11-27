/**
 * Live presence: who is online, which room they are in, whether they are "at home".
 * In-memory for now; a Redis implementation can satisfy the same interface later.
 */
export type PresenceStatus = 'online' | 'busy' | 'away' | 'offline';

export interface PresenceState {
  userId: string;
  status: PresenceStatus;
  /** Office: current workspace + room. */
  workspaceId: string | null;
  roomId: string | null;
  /** Home: in the shared house, plus tile position. */
  atHome: boolean;
  position: { x: number; y: number } | null;
  updatedAt: number;
}

export type PresencePatch = Partial<Omit<PresenceState, 'userId' | 'updatedAt'>>;

export interface PresenceStore {
  /** Register a socket for a user. Returns the state after connecting. */
  connect(userId: string, socketId: string): Promise<PresenceState>;
  /** Remove a socket. Returns `null` while other sockets remain, else the final offline state. */
  disconnect(userId: string, socketId: string): Promise<PresenceState | null>;
  update(userId: string, patch: PresencePatch): Promise<PresenceState | null>;
  get(userId: string): Promise<PresenceState | null>;
  getMany(userIds: readonly string[]): Promise<PresenceState[]>;
}

const offline = (userId: string): PresenceState => ({
  userId,
  status: 'offline',
  workspaceId: null,
  roomId: null,
  atHome: false,
  position: null,
  updatedAt: Date.now(),
});

export class InMemoryPresenceStore implements PresenceStore {
  private readonly states = new Map<string, PresenceState>();
  private readonly sockets = new Map<string, Set<string>>();

  async connect(userId: string, socketId: string): Promise<PresenceState> {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socketId);

    const prev = this.states.get(userId);
    const next: PresenceState = {
      ...(prev ?? offline(userId)),
      status: prev && prev.status !== 'offline' ? prev.status : 'online',
      updatedAt: Date.now(),
    };
    this.states.set(userId, next);
    return next;
  }

  async disconnect(userId: string, socketId: string): Promise<PresenceState | null> {
    const set = this.sockets.get(userId);
    set?.delete(socketId);
    if (set && set.size > 0) return null;

    this.sockets.delete(userId);
    this.states.delete(userId);
    return offline(userId);
  }

  async update(userId: string, patch: PresencePatch): Promise<PresenceState | null> {
    const prev = this.states.get(userId);
    if (!prev) return null;
    const next: PresenceState = { ...prev, ...patch, userId, updatedAt: Date.now() };
    this.states.set(userId, next);
    return next;
  }

  async get(userId: string): Promise<PresenceState | null> {
    return this.states.get(userId) ?? null;
  }

  async getMany(userIds: readonly string[]): Promise<PresenceState[]> {
    return userIds.map((id) => this.states.get(id) ?? offline(id));
  }
}
