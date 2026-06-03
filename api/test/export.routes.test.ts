import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { makeRequireAdmin } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';
import { createExportJobManager } from '../src/lib/exportJob.js';
import { registerExportRoutes } from '../src/routes/export.js';

const SECRET = 'export-routes-secret';
const adminAuth = (eid = 'remembrance') =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' }, SECRET)}`;
const guestAuth = (eid = 'remembrance') =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET)}`;

let app: FastifyInstance;

function build(runner = () => new Promise<{ outputUrl: string }>(() => {})) {
  app = Fastify();
  const manager = createExportJobManager(runner);
  registerExportRoutes(app, makeRequireAdmin(SECRET), manager, {
    renderUrl: 'http://web',
    outDir: '/tmp',
  });
  return manager;
}

beforeEach(async () => {
  build();
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const url = '/api/events/remembrance/admin/export';

describe('export routes auth', () => {
  it('POST 401 without a token and with a guest token', async () => {
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { authorization: guestAuth() } })).statusCode).toBe(401);
  });

  it('GET 401 without a token', async () => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
});

describe('export routes lifecycle', () => {
  it('POST starts a render and returns the running job', async () => {
    const res = await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('running');
  });

  it('a second POST while running returns 409 with the running job', async () => {
    await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    const res = await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { status: string }).status).toBe('running');
  });

  it('GET returns the current job state', async () => {
    const idle = await app.inject({ method: 'GET', url, headers: { authorization: adminAuth() } });
    expect((idle.json() as { status: string }).status).toBe('idle');
    await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    const running = await app.inject({ method: 'GET', url, headers: { authorization: adminAuth() } });
    expect((running.json() as { status: string }).status).toBe('running');
  });
});
