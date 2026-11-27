import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx?.close();
});

describe('http', () => {
  it('GET /health reports db up', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('echoes a request id header', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');

    const generated = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a structured 404', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('sets security headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves the OpenAPI document', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths['/health']).toBeDefined();
  });
});

describe('socket.io', () => {
  let url: string;

  beforeAll(async () => {
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = ctx.app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  const open = (token?: string) =>
    connect(url, { transports: ['websocket'], auth: token ? { token } : {}, reconnection: false, forceNew: true });

  const waitFor = (socket: Socket) =>
    new Promise<'connected' | string>((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('connect_error', (err) => resolve(err.message));
    });

  it('rejects connections without a token', async () => {
    const s = open();
    expect(await waitFor(s)).toBe('unauthorized');
    s.close();
  });

  it('rejects connections with a bad token', async () => {
    const s = open('not-a-jwt');
    expect(await waitFor(s)).toBe('unauthorized');
    s.close();
  });

  it('accepts a valid access token and answers time:sync', async () => {
    const token = ctx.app.jwt.sign({ sub: '507f1f77bcf86cd799439011', typ: 'access' });
    const s = open(token);
    expect(await waitFor(s)).toBe('connected');

    const before = Date.now();
    const res = await s.timeout(2000).emitWithAck('time:sync', 42);
    expect(res.clientTime).toBe(42);
    expect(res.serverTime).toBeGreaterThanOrEqual(before);
    s.close();
  });
});
