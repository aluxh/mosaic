import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireTokenSecret, makeRequireAdmin } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';

describe('requireTokenSecret', () => {
  it('returns the secret when set', () => {
    expect(requireTokenSecret({ TOKEN_SECRET: 's3cret' } as NodeJS.ProcessEnv)).toBe('s3cret');
  });

  it('throws when missing; message mentions TOKEN_SECRET and mint-token', () => {
    expect(() => requireTokenSecret({} as NodeJS.ProcessEnv)).toThrow(/TOKEN_SECRET/);
    expect(() => requireTokenSecret({} as NodeJS.ProcessEnv)).toThrow(/mint-token/);
  });

  it('throws on an empty string', () => {
    expect(() => requireTokenSecret({ TOKEN_SECRET: '' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('makeRequireAdmin', () => {
  const secret = 'admin-gate-secret';

  async function appWithGate() {
    const app = Fastify();
    app.get('/api/events/:id/admin/ping', { preHandler: makeRequireAdmin(secret) }, async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  const admin = (eid = 'remembrance', expDelta = 3600) =>
    `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + expDelta, role: 'admin' }, secret)}`;
  const guest = (eid = 'remembrance') =>
    `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, secret)}`;

  it('accepts a valid admin token', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: admin() } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a guest token (no role) with 401', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: guest() } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects when no Authorization header is present', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an expired admin token', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: admin('remembrance', -10) } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an admin token minted for a different event', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: admin('celebration') } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
