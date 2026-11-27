import fp from 'fastify-plugin';
import { GRIDFS_BUCKET } from '../modules/files/model.js';
import { InMemoryPresenceStore, type PresenceStore } from '../stores/presence.js';
import { InMemoryRoomStateStore, type RoomStateStore } from '../stores/roomState.js';
import { GridFsStorageService, type StorageService } from '../stores/storage.js';

export interface StoresOptions {
  /** Override any store, e.g. to inject Redis/R2 implementations or test doubles. */
  presence?: PresenceStore;
  roomState?: RoomStateStore;
  storage?: StorageService;
}

export default fp<StoresOptions>(
  async (app, opts) => {
    const db = app.mongoose.connection.db;
    if (!db) throw new Error('stores plugin requires an open MongoDB connection');

    app.decorate('presence', opts.presence ?? new InMemoryPresenceStore());
    app.decorate('roomState', opts.roomState ?? new InMemoryRoomStateStore());
    app.decorate('storage', opts.storage ?? new GridFsStorageService(db, GRIDFS_BUCKET));
  },
  { name: 'stores', dependencies: ['db'] },
);
