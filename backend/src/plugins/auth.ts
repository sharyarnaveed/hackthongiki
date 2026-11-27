import jwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { unauthorized } from '../lib/errors.js';

/**
 * Short-lived access tokens (JWT). Refresh tokens are opaque random strings
 * stored hashed in `refreshTokens` (implemented in the auth module, step 2).
 */
export default fp(
  async (app) => {
    await app.register(jwt, {
      secret: app.config.JWT_ACCESS_SECRET,
      sign: { expiresIn: app.config.ACCESS_TOKEN_TTL },
    });

    app.decorate('authenticate', async (request) => {
      try {
        await request.jwtVerify();
      } catch {
        throw unauthorized('Invalid or expired access token');
      }
      if (request.user.typ !== 'access') throw unauthorized('Wrong token type');
    });
  },
  { name: 'auth', dependencies: ['config'] },
);
