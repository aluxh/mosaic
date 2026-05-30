import type { DB } from './index.js';
import type { EventRow, MessageRow, PhotoRow, PhotoSource } from '../types.js';

export function upsertEvent(db: DB, e: EventRow): void {
  db.prepare(
    `INSERT INTO events (id, mode, eyebrow, title, dateline, place, invitation, brand_sub, short_code)
     VALUES (@id, @mode, @eyebrow, @title, @dateline, @place, @invitation, @brand_sub, @short_code)
     ON CONFLICT(id) DO UPDATE SET
       mode = excluded.mode,
       eyebrow = excluded.eyebrow,
       title = excluded.title,
       dateline = excluded.dateline,
       place = excluded.place,
       invitation = excluded.invitation,
       brand_sub = excluded.brand_sub,
       short_code = excluded.short_code`,
  ).run(e);
}

export function listEvents(db: DB): EventRow[] {
  return db.prepare('SELECT * FROM events ORDER BY id').all() as EventRow[];
}

export function getEvent(db: DB, id: string): EventRow | undefined {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
}

export interface InsertPhotoInput {
  id: string;
  event_id: string;
  source: PhotoSource;
  filename: string;
  credit: string;
  created_at: number;
}

export function insertPhoto(db: DB, p: InsertPhotoInput): PhotoRow {
  db.prepare(
    `INSERT INTO photos (id, event_id, source, filename, credit, created_at)
     VALUES (@id, @event_id, @source, @filename, @credit, @created_at)`,
  ).run(p);
  return p as PhotoRow;
}

export function photoExists(db: DB, id: string): boolean {
  const row = db.prepare('SELECT 1 FROM photos WHERE id = ?').get(id);
  return row !== undefined;
}

export function listPhotos(db: DB, eventId: string): PhotoRow[] {
  return db
    .prepare('SELECT * FROM photos WHERE event_id = ? ORDER BY created_at ASC')
    .all(eventId) as PhotoRow[];
}

export interface InsertMessageInput {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
  photo_id?: string | null;
}

export function insertMessage(db: DB, m: InsertMessageInput): MessageRow {
  const row = { ...m, photo_id: m.photo_id ?? null };
  db.prepare(
    `INSERT INTO messages (id, event_id, name, text, created_at, photo_id)
     VALUES (@id, @event_id, @name, @text, @created_at, @photo_id)`,
  ).run(row);
  return row as MessageRow;
}

export function listMessages(db: DB, eventId: string): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE event_id = ? ORDER BY created_at ASC')
    .all(eventId) as MessageRow[];
}
