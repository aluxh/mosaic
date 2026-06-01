import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { registerEventRoutes } from '../src/routes/events.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

let db: DB;
let app: FastifyInstance;

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
});
afterEach(async () => {
  if (app) await app.close();
  db.close();
});

describe('CORS', () => {
  it('does not emit Access-Control-Allow-Origin for a cross-origin request', async () => {
    app = Fastify();
    registerEventRoutes(app, db);
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
