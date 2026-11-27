import type { FastifyReply, FastifyRequest } from 'fastify';
import type mongoose from 'mongoose';
import type { Server as SocketServer } from 'socket.io';
import type { Env } from '../config/env.js';
import type { PresenceStore } from '../stores/presence.js';
import type { RoomStateStore } from '../stores/roomState.js';
import type { StorageService } from '../stores/storage.js';

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    mongoose: typeof mongoose;
    storage: StorageService;
    presence: PresenceStore;
    roomState: RoomStateStore;
    io: SocketServer;
    /** preHandler: verifies the access JWT and sets `request.user`. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}
