import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CoupleInviteModel,
  CoupleModel,
  NftOwnershipModel,
  RefreshTokenModel,
  RoomModel,
  UserModel,
  WebhookEventModel,
  WorkspaceModel,
} from '../src/models.js';
import { createTestApp, resetDb, type TestContext } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx?.close();
});
beforeEach(resetDb);

const oid = () => new Types.ObjectId();

async function indexesOf(model: { collection: { indexes(): Promise<Array<Record<string, unknown>>> } }) {
  return model.collection.indexes();
}

describe('indexes', () => {
  it('creates TTL indexes on refreshTokens and coupleInvites', async () => {
    for (const m of [RefreshTokenModel, CoupleInviteModel]) {
      const ttl = (await indexesOf(m)).find((i) => (i.key as Record<string, number>).expiresAt === 1);
      expect(ttl?.expireAfterSeconds).toBe(0);
    }
  });

  it('indexes workspace members.userId', async () => {
    const idx = await indexesOf(WorkspaceModel);
    expect(idx.some((i) => 'members.userId' in (i.key as object))).toBe(true);
  });

  it('builds the GridFS metadata index', async () => {
    const idx = await ctx.app.mongoose.connection.db!.collection('files.files').indexes();
    expect(idx.some((i) => i.name === 'metadata_scope_uploadDate')).toBe(true);
  });
});

describe('constraints', () => {
  it('rejects duplicate webhook event ids', async () => {
    await WebhookEventModel.create({ eventId: 'evt_1', source: 'alchemy' });
    await expect(WebhookEventModel.create({ eventId: 'evt_1', source: 'alchemy' })).rejects.toMatchObject({ code: 11000 });
  });

  it('allows a user in only one couple, whether as userA or userB', async () => {
    const [a, b, c] = [oid(), oid(), oid()];
    await CoupleModel.create({ userA: a, userB: b });
    await expect(CoupleModel.create({ userA: c, userB: a })).rejects.toMatchObject({ code: 11000 });
    await expect(CoupleModel.create({ userA: b, userB: c })).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects a couple with the same user twice', async () => {
    const a = oid();
    await expect(CoupleModel.create({ userA: a, userB: a })).rejects.toThrow(/two different users/);
  });

  it('keeps one ownership row per wallet/contract/token', async () => {
    const row = {
      wallet: '0x' + 'a'.repeat(40),
      contract: '0x' + 'b'.repeat(40),
      tokenId: '7',
      amount: 1,
    };
    await NftOwnershipModel.create(row);
    await expect(NftOwnershipModel.create(row)).rejects.toMatchObject({ code: 11000 });
  });

  it('enforces unique lowercase emails', async () => {
    await UserModel.create({ email: 'Alex@Acme.dev', passwordHash: 'h', name: 'Alex' });
    await expect(UserModel.create({ email: 'alex@acme.dev', passwordHash: 'h', name: 'Alex 2' })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe('serialization', () => {
  it('never exposes passwordHash and maps _id to id', async () => {
    const created = await UserModel.create({ email: 'sam@home.dev', passwordHash: 'secret-hash', name: 'Sam' });
    const json = created.toJSON() as Record<string, unknown>;
    expect(json.passwordHash).toBeUndefined();
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.id).toBe(String(created._id));
    expect(json.color).toBe('#2563eb');

    const fetched = await UserModel.findById(created._id).lean();
    expect(fetched).not.toHaveProperty('passwordHash');
  });

  it('exposes room type as `kind` with floor placement fields', async () => {
    const room = await RoomModel.create({ workspaceId: oid(), name: 'Boardroom', type: 'meeting', capacity: 12, x: 14, y: 1, w: 9, h: 6 });
    const json = room.toJSON() as Record<string, unknown>;
    expect(json).toMatchObject({ kind: 'meeting', capacity: 12, x: 14, y: 1, w: 9, h: 6 });
    expect(json.type).toBeUndefined();
  });

  it('validates workspace slug format', async () => {
    await expect(WorkspaceModel.create({ name: 'Acme', slug: 'Not A Slug!', ownerId: oid() })).rejects.toThrow(/slug/);
  });
});
