import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const ethAddress = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 0x-prefixed 20-byte address')
  .transform((v) => v.toLowerCase() as `0x${string}`);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024, 'max 50MB')
    .default(50 * 1024 * 1024),

  LIVEKIT_URL: optionalString,
  LIVEKIT_API_KEY: optionalString,
  LIVEKIT_API_SECRET: optionalString,

  BASE_RPC_URL: z.url().default('https://mainnet.base.org'),
  BASE_CHAIN_ID: z.coerce.number().int().default(8453),
  DECOR_CONTRACT_ADDRESS: z.union([ethAddress, z.literal('').transform(() => undefined)]).optional(),
  MARKETPLACE_CONTRACT_ADDRESS: z.union([ethAddress, z.literal('').transform(() => undefined)]).optional(),

  ALCHEMY_WEBHOOK_SIGNING_KEY: optionalString,
  CROSSMINT_WEBHOOK_SECRET: optionalString,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables. Throws a readable error listing
 * every invalid/missing variable. `MONGODB` is accepted as a legacy alias
 * for `MONGODB_URI`.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const input = { ...source };
  if (!input.MONGODB_URI && input.MONGODB) input.MONGODB_URI = input.MONGODB;

  const result = envSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
