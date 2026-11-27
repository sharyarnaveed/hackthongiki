import fp from 'fastify-plugin';
import mongoose from 'mongoose';
import { allModels } from '../models.js';
import { GRIDFS_BUCKET } from '../modules/files/model.js';
import { ensureStorageIndexes } from '../stores/storage.js';

/**
 * Connects Mongoose, builds indexes, and exposes the connection.
 * Index builds are awaited so TTL/unique constraints exist before traffic.
 */
export default fp(
  async (app) => {
    const { MONGODB_URI, NODE_ENV } = app.config;

    mongoose.set('strictQuery', true);
    // Index creation is explicit below, not lazy per model.
    mongoose.set('autoIndex', false);

    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      appName: 'virtual-office-backend',
    });

    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connected but no database handle is available');

    await Promise.all(allModels.map((m) => (m as mongoose.Model<unknown>).createIndexes()));
    await ensureStorageIndexes(db, GRIDFS_BUCKET);

    app.log.info({ db: db.databaseName, env: NODE_ENV }, 'mongodb connected');
    app.decorate('mongoose', mongoose);

    app.addHook('onClose', async () => {
      await mongoose.disconnect();
    });
  },
  { name: 'db', dependencies: ['config'] },
);
