import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileMetadata } from '../src/modules/files/model.js';
import { InMemoryPresenceStore } from '../src/stores/presence.js';
import { currentPosition, InMemoryRoomStateStore } from '../src/stores/roomState.js';
import { FileTooLargeError } from '../src/stores/storage.js';
import { createTestApp, type TestContext } from './helpers/app.js';

describe('InMemoryPresenceStore', () => {
  it('stays online until the last socket disconnects', async () => {
    const store = new InMemoryPresenceStore();
    await store.connect('u1', 's1');
    await store.connect('u1', 's2');
    expect((await store.get('u1'))?.status).toBe('online');

    expect(await store.disconnect('u1', 's1')).toBeNull();
    expect((await store.get('u1'))?.status).toBe('online');

    expect((await store.disconnect('u1', 's2'))?.status).toBe('offline');
    expect(await store.get('u1')).toBeNull();
  });

  it('updates room / at-home state and reports unknown users as offline', async () => {
    const store = new InMemoryPresenceStore();
    await store.connect('u1', 's1');
    await store.update('u1', { workspaceId: 'w1', roomId: 'r1', status: 'busy' });
    expect(await store.update('ghost', { atHome: true })).toBeNull();

    const [u1, ghost] = await store.getMany(['u1', 'ghost']);
    expect(u1).toMatchObject({ roomId: 'r1', status: 'busy' });
    expect(ghost).toMatchObject({ userId: 'ghost', status: 'offline' });
  });
});

describe('InMemoryRoomStateStore', () => {
  it('patches state and stamps updatedAt', async () => {
    const store = new InMemoryRoomStateStore();
    const s = await store.patch('room', { playing: true, position: 10, videoRef: { ciphertext: 'c', iv: 'i' } });
    expect(s).toMatchObject({ playing: true, position: 10 });
    expect((await store.get('room'))?.videoRef).toEqual({ ciphertext: 'c', iv: 'i' });
    await store.delete('room');
    expect(await store.get('room')).toBeNull();
  });

  it('extrapolates the playback position for late joiners', () => {
    const state = { videoRef: null, playing: true, position: 10, updatedAt: 1_000, updatedBy: null };
    expect(currentPosition(state, 3_500)).toBeCloseTo(12.5);
    expect(currentPosition({ ...state, playing: false }, 3_500)).toBe(10);
  });
});

describe('GridFsStorageService', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });

  const meta = (scopeId = new Types.ObjectId()): FileMetadata => ({
    ownerScope: 'workspace',
    scopeId,
    uploaderId: new Types.ObjectId(),
    mime: 'image/png',
    encryptedKey: 'wrapped-key',
  });

  it('uploads, lists, downloads and deletes', async () => {
    const { storage } = ctx.app;
    const scopeId = new Types.ObjectId();
    const payload = Buffer.from('encrypted-bytes'.repeat(1000));

    const stored = await storage.upload(Readable.from([payload]), { filename: 'a.bin', metadata: meta(scopeId) });
    expect(stored.length).toBe(payload.length);
    expect(stored.metadata.mime).toBe('image/png');

    const listed = await storage.list({ scopeId: String(scopeId) });
    expect(listed.map((f) => f.id)).toEqual([stored.id]);

    expect(await buffer(storage.openDownload(stored.id))).toEqual(payload);

    await storage.delete(stored.id);
    expect(await storage.find(stored.id)).toBeNull();
  });

  it('aborts and cleans up uploads over maxBytes', async () => {
    const { storage } = ctx.app;
    const scopeId = new Types.ObjectId();
    const chunks = Array.from({ length: 10 }, () => Buffer.alloc(1024, 1));

    await expect(
      storage.upload(Readable.from(chunks), { filename: 'big.bin', metadata: meta(scopeId), maxBytes: 4096 }),
    ).rejects.toBeInstanceOf(FileTooLargeError);

    expect(await storage.list({ scopeId: String(scopeId) })).toHaveLength(0);
    const orphanChunks = await ctx.app.mongoose.connection.db!.collection('files.chunks').countDocuments();
    expect(orphanChunks).toBe(0);
  });

  it('returns null for unknown or malformed ids', async () => {
    expect(await ctx.app.storage.find(String(new Types.ObjectId()))).toBeNull();
    expect(await ctx.app.storage.find('nope')).toBeNull();
  });
});
