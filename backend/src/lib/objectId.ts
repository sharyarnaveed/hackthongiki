import { Types } from 'mongoose';
import { z } from 'zod';

export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'must be a 24-char hex ObjectId')
  .describe('MongoDB ObjectId');

export const idParamsSchema = z.object({ id: objectIdSchema });

export const toObjectId = (id: string | Types.ObjectId) =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

export const isObjectId = (id: unknown): id is string =>
  typeof id === 'string' && Types.ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id);
