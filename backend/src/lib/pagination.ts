import { z } from 'zod';
import { badRequest } from './errors.js';

/**
 * Opaque cursor for (createdAt desc, _id desc) keyset pagination.
 * Encodes `<createdAt ms>:<objectId>` as base64url.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.getTime()}:${c.id}`).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const [ms, id] = Buffer.from(raw, 'base64url').toString('utf8').split(':');
  const n = Number(ms);
  if (!ms || !id || !Number.isFinite(n) || !/^[a-f0-9]{24}$/i.test(id)) throw badRequest('Invalid cursor');
  return { createdAt: new Date(n), id };
}

export const paginationQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
