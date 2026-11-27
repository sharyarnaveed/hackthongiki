import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { buildApp, type App } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-123456';

export function testEnv(mongoUri: string, overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MONGODB_URI: mongoUri,
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    ...overrides,
  });
}

export interface TestContext {
  app: App;
  mongo: MongoMemoryServer;
  close: () => Promise<void>;
}

/** Spin up an in-memory MongoDB and a fully wired app against it. */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const mongo = await MongoMemoryServer.create();
  const app = await buildApp({ env: testEnv(mongo.getUri('vo-test'), overrides), logger: false });
  await app.ready();
  return {
    app,
    mongo,
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

/** Wipe every collection between tests (keeps indexes). */
export async function resetDb(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
