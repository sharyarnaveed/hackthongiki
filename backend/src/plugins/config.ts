import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';

export default fp<{ env: Env }>(
  async (app, opts) => {
    app.decorate('config', opts.env);
  },
  { name: 'config' },
);
