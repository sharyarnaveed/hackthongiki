# Virtual Office — Backend

Fastify + TypeScript API for Virtual Office (Office mode for remote teams, Home mode for couples).

## Stack

Fastify 5 · Zod 4 (`fastify-type-provider-zod`) · MongoDB/Mongoose (GridFS for files) · `@fastify/jwt` + argon2 ·
Socket.io · LiveKit server SDK · viem (Base) · pino · Vitest + mongodb-memory-server · OpenAPI via `@fastify/swagger`.

## Getting started

```bash
cd backend
npm install
cp .env.example .env        # fill in JWT_ACCESS_SECRET (32+ chars) and MONGODB_URI
docker compose up -d        # local MongoDB on :27017 (or point MONGODB_URI at Atlas)
npm run dev                 # http://localhost:4000, docs at /docs
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with reload (tsx watch) |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Vitest suite (spins up an in-memory MongoDB; first run downloads a mongod binary) |
| `npm run seed` | Seed mock data (coming in a later step) |

## Layout

```
src/
  index.ts            entry: load env, build app, listen, graceful shutdown
  app.ts              buildApp(): plugins, error handling, /health, modules
  config/env.ts       Zod-validated environment
  plugins/            config, db (Mongoose + indexes), stores, auth (JWT), security
                      (cors/helmet/rate-limit/multipart), swagger, socket (Socket.io + JWT handshake)
  stores/             swappable interfaces: PresenceStore, RoomStateStore, StorageService
  realtime/           Socket.io handlers
  modules/<feature>/  {routes,service,schema,model}.ts
  models.ts           barrel of every model (indexes are built at startup)
test/                 Vitest suites + helpers
```

## Privacy model

Messages, files, memories and watch-sync payloads are encrypted on the client. The server stores only
ciphertext, IVs, wrapped keys and public keys. It never holds user funds or private keys.

## Swapping infrastructure

`PresenceStore`, `RoomStateStore` and `StorageService` are interfaces with in-memory / GridFS defaults.
Pass alternatives to `buildApp({ env, stores: { presence, roomState, storage } })` to use Redis or R2
without changing routes.
