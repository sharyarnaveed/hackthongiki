import fp from 'fastify-plugin';
import { Server, type Socket } from 'socket.io';
import { registerRealtime } from '../realtime/index.js';
import type { AccessTokenPayload } from '../types/fastify.js';

export interface SocketData {
  userId: string;
}

export type AppSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

/**
 * Socket.io on the same HTTP server. Every connection must present a valid
 * access token in `handshake.auth.token`; otherwise the handshake is rejected.
 */
export default fp(
  async (app) => {
    const io = new Server(app.server, {
      cors: { origin: app.config.CORS_ORIGINS, credentials: true },
      maxHttpBufferSize: 1_000_000,
      serveClient: false,
    });

    io.use((socket, next) => {
      const raw: unknown = socket.handshake.auth?.token;
      const token = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '') : '';
      if (!token) return next(new Error('unauthorized'));
      try {
        const payload = app.jwt.verify<AccessTokenPayload>(token);
        if (payload.typ !== 'access') return next(new Error('unauthorized'));
        (socket.data as SocketData).userId = payload.sub;
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });

    registerRealtime(io, app);

    app.decorate('io', io);
    app.addHook('preClose', async () => {
      io.disconnectSockets(true);
    });
    app.addHook('onClose', async () => {
      await io.close();
    });
  },
  { name: 'socket', dependencies: ['auth', 'stores'] },
);
