import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/vo',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ACCESS_TOKEN_TTL).toBe('15m');
    expect(env.MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.LIVEKIT_API_KEY).toBeUndefined();
  });

  it('accepts the legacy MONGODB variable', () => {
    const env = loadEnv({ MONGODB: 'mongodb+srv://u:p@cluster.example.net/vo', JWT_ACCESS_SECRET: 'x'.repeat(32) });
    expect(env.MONGODB_URI).toBe('mongodb+srv://u:p@cluster.example.net/vo');
  });

  it('splits CORS origins and coerces numbers', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test', PORT: '8080' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.PORT).toBe(8080);
  });

  it('lowercases contract addresses and treats empty as unset', () => {
    const env = loadEnv({
      ...base,
      DECOR_CONTRACT_ADDRESS: '0xABCDEFabcdef0123456789abcdef0123456789AB',
      MARKETPLACE_CONTRACT_ADDRESS: '',
    });
    expect(env.DECOR_CONTRACT_ADDRESS).toBe('0xabcdefabcdef0123456789abcdef0123456789ab');
    expect(env.MARKETPLACE_CONTRACT_ADDRESS).toBeUndefined();
  });

  it('reports every invalid variable', () => {
    expect(() => loadEnv({ MONGODB_URI: 'postgres://nope', JWT_ACCESS_SECRET: 'short', MAX_UPLOAD_BYTES: '999999999' })).toThrow(
      /MONGODB_URI[\s\S]*JWT_ACCESS_SECRET[\s\S]*MAX_UPLOAD_BYTES/,
    );
  });
});
