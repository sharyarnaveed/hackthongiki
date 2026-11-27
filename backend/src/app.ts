import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from './config/env.js';
import { HttpError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import configPlugin from './plugins/config.js';
import dbPlugin from './plugins/db.js';
import securityPlugin from './plugins/security.js';
import socketPlugin from './plugins/socket.js';
import storesPlugin, { type StoresOptions } from './plugins/stores.js';
import swaggerPlugin from './plugins/swagger.js';

export interface BuildAppOptions {
  env: Env;
  stores?: StoresOptions;
  logger?: FastifyServerOptions['logger'];
}

function defaultLogger(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-alchemy-signature"]'],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

export async function buildApp({ env, stores, logger }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? defaultLogger(env),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: err.validation },
        requestId: request.id,
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
        requestId: request.id,
      });
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err, cause: err.cause }, 'response serialization failed');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal error' }, requestId: request.id });
    }

    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) request.log.error({ err }, 'unhandled error');
    return reply.status(status).send({
      error: {
        code: (err as { code?: string }).code ?? (status >= 500 ? 'INTERNAL' : 'ERROR'),
        message: status >= 500 ? 'Internal error' : (err as Error).message,
      },
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' }, requestId: request.id }),
  );

  await app.register(configPlugin, { env });
  await app.register(swaggerPlugin);
  await app.register(securityPlugin);
  await app.register(dbPlugin);
  await app.register(storesPlugin, stores ?? {});
  await app.register(authPlugin);
  await app.register(socketPlugin);

  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        security: [],
        response: {
          200: z.object({ status: z.literal('ok'), db: z.enum(['up', 'down']), time: z.number() }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      db: app.mongoose.connection.readyState === 1 ? ('up' as const) : ('down' as const),
      time: Date.now(),
    }),
  );

  // Feature modules are registered here from step 2 onwards.

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
