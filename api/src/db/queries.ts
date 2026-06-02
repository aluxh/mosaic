import type { DB } from './index.js';
import type { EventRow, MessageRow, PhotoRow, PhotoSource } from '../types.js';

export function upsertEvent(db: DB, e: EventRow): void {
  db.prepare(
    `INSERT INTO events (id, mode, eyebrow, title, dateline, place, invitation, brand_sub, short_code, transition_style)
     VALUES (@id, @mode, @eyebrow, @title, @dateline, @place, @invitation, @brand_sub, @short_code, @transition_style)
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
    .prepare('SELECT * FROM photos WHERE event_id = ? AND hidden = 0 ORDER BY created_at ASC')
    .all(eventId) as PhotoRow[];
}

export function listAllPhotos(db: DB, eventId: string): PhotoRow[] {
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
  const row = { ...m, photo_id: m.photo_id ?? null, hidden: 0 };
  db.prepare(
    `INSERT INTO messages (id, event_id, name, text, created_at, photo_id)
     VALUES (@id, @event_id, @name, @text, @created_at, @photo_id)`,
  ).run(row);
  return row as MessageRow;
}

export function listMessages(db: DB, eventId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT * FROM messages
       WHERE event_id = ? AND hidden = 0
         AND (photo_id IS NULL OR photo_id IN (SELECT id FROM photos WHERE hidden = 0))
       ORDER BY created_at ASC`,
    )
    .all(eventId) as MessageRow[];
}

export function listAdminMessages(db: DB, eventId: string): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE event_id = ? AND photo_id IS NULL ORDER BY created_at ASC')
    .all(eventId) as MessageRow[];
}

export function setMessageHidden(db: DB, eventId: string, messageId: string, hidden: boolean): boolean {
  const info = db
    .prepare('UPDATE messages SET hidden = ? WHERE id = ? AND event_id = ? AND photo_id IS NULL')
    .run(hidden ? 1 : 0, messageId, eventId);
  return info.changes > 0;
}

export function deleteMessage(db: DB, eventId: string, messageId: string): boolean {
  const info = db
    .prepare('DELETE FROM messages WHERE id = ? AND event_id = ? AND photo_id IS NULL')
    .run(messageId, eventId);
  return info.changes > 0;
}

export function listAdminPhotos(db: DB, eventId: string): PhotoRow[] {
  return db
    .prepare('SELECT * FROM photos WHERE event_id = ? ORDER BY created_at ASC')
    .all(eventId) as PhotoRow[];
}

export function getPhotoForEvent(db: DB, eventId: string, photoId: string): PhotoRow | undefined {
  return db
    .prepare('SELECT * FROM photos WHERE id = ? AND event_id = ?')
    .get(photoId, eventId) as PhotoRow | undefined;
}

export function setPhotoHidden(db: DB, eventId: string, photoId: string, hidden: boolean): boolean {
  const info = db
    .prepare('UPDATE photos SET hidden = ? WHERE id = ? AND event_id = ?')
    .run(hidden ? 1 : 0, photoId, eventId);
  return info.changes > 0;
}

export function deletePhotoCascade(db: DB, eventId: string, photoId: string): PhotoRow | undefined {
  const tx = db.transaction(() => {
    const row = getPhotoForEvent(db, eventId, photoId);
    if (!row) return undefined;
    db.prepare('DELETE FROM messages WHERE photo_id = ? AND event_id = ?').run(photoId, eventId);
    db.prepare('DELETE FROM photos WHERE id = ? AND event_id = ?').run(photoId, eventId);
    return row;
  });
  return tx();
}

export function updateTransitionStyle(db: DB, eventId: string, style: string): void {
  db.prepare('UPDATE events SET transition_style = ? WHERE id = ?').run(style, eventId);
}
