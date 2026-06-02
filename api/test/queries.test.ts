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
  listAllPhotos,
  listAdminPhotos,
  setPhotoHidden,
  getPhotoForEvent,
  deletePhotoCascade,
  updateTransitionStyle,
  getEvent,
  listAdminMessages,
  setMessageHidden,
  deleteMessage,
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
    transition_style: 'default',
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
      transition_style: 'default',
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

describe('admin curation queries', () => {
  beforeEach(() => {
    insertPhoto(db, { id: 'p1', event_id: 'remembrance', source: 'seed', filename: 'a.jpg', credit: 'A', created_at: 100 });
    insertPhoto(db, { id: 'p2', event_id: 'remembrance', source: 'upload', filename: 'b.jpg', credit: 'B', created_at: 200 });
  });

  it('listPhotos excludes hidden rows; listAdminPhotos includes them', () => {
    setPhotoHidden(db, 'remembrance', 'p1', true);
    expect(listPhotos(db, 'remembrance').map((r) => r.id)).toEqual(['p2']);
    expect(listAdminPhotos(db, 'remembrance').map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('listAllPhotos includes visible and hidden rows for the event', () => {
    upsertEvent(db, {
      id: 'celebration',
      mode: 'celebration',
      eyebrow: 'Celebrate',
      title: 'Party',
      dateline: 'date',
      place: 'place',
      invitation: 'invite',
      brand_sub: 'sub',
      short_code: 'X2',
      transition_style: 'default',
    });
    insertPhoto(db, { id: 'other', event_id: 'celebration', source: 'seed', filename: 'c.jpg', credit: 'C', created_at: 50 });
    setPhotoHidden(db, 'remembrance', 'p1', true);

    expect(listAllPhotos(db, 'remembrance').map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('setPhotoHidden flips the flag and reports update vs no-op', () => {
    expect(setPhotoHidden(db, 'remembrance', 'p1', true)).toBe(true);
    expect(getPhotoForEvent(db, 'remembrance', 'p1')?.hidden).toBe(1);
    expect(setPhotoHidden(db, 'remembrance', 'missing', true)).toBe(false);
    expect(setPhotoHidden(db, 'celebration', 'p1', true)).toBe(false); // wrong event
  });

  it('getPhotoForEvent returns the row only for the matching event', () => {
    expect(getPhotoForEvent(db, 'remembrance', 'p2')?.filename).toBe('b.jpg');
    expect(getPhotoForEvent(db, 'celebration', 'p2')).toBeUndefined();
  });

  it('deletePhotoCascade removes the photo + linked messages in one tx and returns the row', () => {
    insertMessage(db, { id: 'm1', event_id: 'remembrance', name: 'A', text: 'linked', created_at: 5, photo_id: 'p1' });
    insertMessage(db, { id: 'm2', event_id: 'remembrance', name: 'B', text: 'standalone', created_at: 6 });
    const deleted = deletePhotoCascade(db, 'remembrance', 'p1');
    expect(deleted).toMatchObject({ filename: 'a.jpg', source: 'seed' });
    expect(getPhotoForEvent(db, 'remembrance', 'p1')).toBeUndefined();
    expect(listMessages(db, 'remembrance').map((m) => m.id)).toEqual(['m2']);
  });

  it('deletePhotoCascade returns undefined for a photo not in the event', () => {
    expect(deletePhotoCascade(db, 'celebration', 'p1')).toBeUndefined();
    expect(getPhotoForEvent(db, 'remembrance', 'p1')).toBeDefined();
  });

  it('updateTransitionStyle persists a valid value', () => {
    updateTransitionStyle(db, 'remembrance', 'cinematic');
    expect(getEvent(db, 'remembrance')?.transition_style).toBe('cinematic');
  });
});

describe('message curation queries', () => {
  beforeEach(() => {
    insertPhoto(db, { id: 'p1', event_id: 'remembrance', source: 'upload', filename: 'a.jpg', credit: 'A', created_at: 1 });
    insertMessage(db, { id: 'standalone', event_id: 'remembrance', name: 'A', text: 'no photo', created_at: 10 });
    insertMessage(db, { id: 'paired', event_id: 'remembrance', name: 'B', text: 'with photo', created_at: 20, photo_id: 'p1' });
  });

  it('public listMessages excludes a hidden standalone message', () => {
    expect(setMessageHidden(db, 'remembrance', 'standalone', true)).toBe(true);
    expect(listMessages(db, 'remembrance').map((m) => m.id)).toEqual(['paired']);
  });

  it('public listMessages excludes a caption whose photo is hidden, keeps it when visible', () => {
    expect(listMessages(db, 'remembrance').map((m) => m.id)).toEqual(['standalone', 'paired']);
    setPhotoHidden(db, 'remembrance', 'p1', true);
    expect(listMessages(db, 'remembrance').map((m) => m.id)).toEqual(['standalone']);
  });

  it('listAdminMessages returns standalone incl. hidden, excludes paired', () => {
    setMessageHidden(db, 'remembrance', 'standalone', true);
    expect(listAdminMessages(db, 'remembrance').map((m) => m.id)).toEqual(['standalone']);
  });

  it('setMessageHidden flips standalone, no-ops on paired/missing/wrong-event', () => {
    expect(setMessageHidden(db, 'remembrance', 'standalone', true)).toBe(true);
    expect(setMessageHidden(db, 'remembrance', 'paired', true)).toBe(false);
    expect(setMessageHidden(db, 'remembrance', 'missing', true)).toBe(false);
    expect(setMessageHidden(db, 'celebration', 'standalone', true)).toBe(false);
  });

  it('deleteMessage removes standalone, no-ops on paired/missing/wrong-event', () => {
    expect(deleteMessage(db, 'remembrance', 'paired')).toBe(false);
    expect(deleteMessage(db, 'remembrance', 'missing')).toBe(false);
    expect(deleteMessage(db, 'remembrance', 'standalone')).toBe(true);
    expect(listAdminMessages(db, 'remembrance').map((m) => m.id)).toEqual([]);
  });
});
