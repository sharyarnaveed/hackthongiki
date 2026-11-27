import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';

/** Named rate-limit presets; attach per route via `config: { rateLimit: RATE_LIMITS.auth }`. */
export const RATE_LIMITS = {
  auth: { max: 10, timeWindow: '1 minute' },
  chat: { max: 120, timeWindow: '1 minute' },
  upload: { max: 20, timeWindow: '1 minute' },
  webhook: { max: 300, timeWindow: '1 minute' },
} as const;

export default fp(
  async (app) => {
    const { CORS_ORIGINS, MAX_UPLOAD_BYTES, NODE_ENV } = app.config;

    await app.register(helmet, {
      // Swagger UI needs inline scripts/styles; API responses are JSON.
      contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    });

    await app.register(cors, {
      origin: CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['x-request-id'],
    });

    // In-memory store. global:false means only routes that opt in are limited.
    await app.register(rateLimit, {
      global: false,
      keyGenerator: (req) => req.ip,
    });

    await app.register(multipart, {
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 1,
        fields: 10,
        fieldSize: 16 * 1024,
      },
    });
  },
  { name: 'security', dependencies: ['config'] },
);
