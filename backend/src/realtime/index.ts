import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';

/**
 * Wires up all realtime handlers. Filled in over the next steps:
 *  - step 4: presence, chat:<scopeId>
 *  - step 7: call:<id> signaling, watch:<roomId>, time:sync
 */
export function registerRealtime(io: Server, app: FastifyInstance): void {
  io.on('connection', (socket) => {
    const userId = (socket.data as { userId: string }).userId;
    app.log.debug({ userId, socketId: socket.id }, 'socket connected');

    // Minimal clock sync available from day one: client sends its time, gets server time back.
    socket.on('time:sync', (clientTime: unknown, ack?: (res: { clientTime: unknown; serverTime: number }) => void) => {
      if (typeof ack === 'function') ack({ clientTime, serverTime: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      app.log.debug({ userId, socketId: socket.id, reason }, 'socket disconnected');
    });
  });
}
