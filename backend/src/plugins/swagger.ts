import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** OpenAPI docs, generated from the Zod route schemas. UI at /docs. */
export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Virtual Office API',
          description: 'Office (remote teams) and Home (couples) backend.',
          version: '0.1.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger' },
);
