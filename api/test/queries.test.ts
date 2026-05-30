import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import {
  upsertEvent,
  listEvents,
  insertMessage,
  listMessages,
  insertPhoto,
  listPhotos,
} from '../src/db/queries.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

let db: DB;

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
  upsertEvent(db, {
    id: 'remembrance',
    mode: 'remembrance',
    eyebrow: 'In memory',
    title: 'Theodore',
    dateline: 'date',
    place: 'place',
    invitation: 'invite',
    brand_sub: 'sub',
    short_code: 'X1',
  });
});

afterEach(() => {
  db.close();
});

describe('events queries', () => {
  it('upsertEvent + listEvents round-trip', () => {
    const rows = listEvents(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('remembrance');
  });

  it('upsertEvent updates an existing row', () => {
    upsertEvent(db, {
      id: 'remembrance',
      mode: 'remembrance',
      eyebrow: 'changed',
      title: 'T',
      dateline: 'd',
      place: 'p',
      invitation: 'i',
      brand_sub: 's',
      short_code: 'X2',
    });
    const [row] = listEvents(db);
    expect(row?.eyebrow).toBe('changed');
    expect(row?.short_code).toBe('X2');
  });
});

describe('messages queries', () => {
  it('insertMessage + listMessages sorted by created_at', () => {
    insertMessage(db, {
      id: 'm2',
      event_id: 'remembrance',
      name: 'B',
      text: 'second',
      created_at: 200,
    });
    insertMessage(db, {
      id: 'm1',
      event_id: 'remembrance',
      name: 'A',
      text: 'first',
      created_at: 100,
    });
    const rows = listMessages(db, 'remembrance');
    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2']);
  });

  it('insertMessage persists a photo_id link', () => {
    insertPhoto(db, {
      id: 'p1',
      event_id: 'remembrance',
      source: 'upload',
      filename: 'a.jpg',
      credit: 'Maya',
      created_at: 1,
    });
    insertMessage(db, {
      id: 'msg-linked',
      event_id: 'remembrance',
      name: 'Maya',
      text: 'With my photo',
      created_at: 10,
      photo_id: 'p1',
    });
    const row = listMessages(db, 'remembrance').find((r) => r.id === 'msg-linked');
    expect(row?.photo_id).toBe('p1');
  });

  it('insertMessage defaults photo_id to null when omitted', () => {
    insertMessage(db, {
      id: 'msg-standalone',
      event_id: 'remembrance',
      name: 'Eleanor',
      text: 'No photo',
      created_at: 11,
    });
    const row = listMessages(db, 'remembrance').find((r) => r.id === 'msg-standalone');
    expect(row?.photo_id).toBeNull();
  });
});

describe('photos queries', () => {
  it('insertPhoto + listPhotos sorted by created_at', () => {
    insertPhoto(db, {
      id: 'p2',
      event_id: 'remembrance',
      source: 'upload',
      filename: 'b.jpg',
      credit: 'B',
      created_at: 200,
    });
    insertPhoto(db, {
      id: 'p1',
      event_id: 'remembrance',
      source: 'seed',
      filename: 'a.jpg',
      credit: 'A',
      created_at: 100,
    });
    const rows = listPhotos(db, 'remembrance');
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']);
  });
});
