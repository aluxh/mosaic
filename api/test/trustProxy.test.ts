import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { parseTrustProxy, DEFAULT_TRUST_PROXY } from '../src/lib/trustProxy.js';

describe('parseTrustProxy', () => {
  it('returns the documented default when unset or blank', () => {
    expect(parseTrustProxy(undefined)).toEqual(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy('')).toEqual(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy('   ')).toEqual(DEFAULT_TRUST_PROXY);
  });

  it('parses booleans case-insensitively', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('parses a hop count', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('parses a comma-separated CIDR / IP list, trimming whitespace', () => {
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12'))
      .toEqual(['10.0.0.0/8', '172.16.0.0/12']);
    expect(parseTrustProxy('127.0.0.1')).toEqual(['127.0.0.1']);
  });
});

describe('trust proxy (Fastify integration)', () => {
  let app: FastifyInstance;
  afterEach(async () => { if (app) await app.close(); });

  it('honors X-Forwarded-For when the proxy is trusted', async () => {
    app = Fastify({ trustProxy: parseTrustProxy('true') });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.json().ip).toBe('1.2.3.4');
  });

  it('ignores X-Forwarded-For when the proxy is not trusted', async () => {
    app = Fastify({ trustProxy: parseTrustProxy('false') });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.json().ip).not.toBe('1.2.3.4');
  });
});
