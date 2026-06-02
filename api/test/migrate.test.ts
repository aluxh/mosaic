import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

describe('migrate', () => {
  it('applies migrations and records each in schema_migrations', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const applied = (
      db.prepare('SELECT filename FROM schema_migrations').all() as { filename: string }[]
    ).map((r) => r.filename);
    expect(applied).toContain('001_init.sql');
    db.close();
  });

  it('adds messages.photo_id', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const cols = (
      db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('photo_id');
    db.close();
  });

  it('is idempotent across repeated runs', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const count = () =>
      (db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n;
    const first = count();
    expect(() => migrate(db)).not.toThrow();
    expect(count()).toBe(first);
    db.close();
  });

  it('adds photos.hidden defaulting to 0 and events.transition_style defaulting to default', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const photoCols = (
      db.prepare('PRAGMA table_info(photos)').all() as { name: string; dflt_value: string | null }[]
    );
    const eventCols = (
      db.prepare('PRAGMA table_info(events)').all() as { name: string; dflt_value: string | null }[]
    );
    const hidden = photoCols.find((c) => c.name === 'hidden');
    const style = eventCols.find((c) => c.name === 'transition_style');
    expect(hidden?.dflt_value).toBe('0');
    expect(style?.dflt_value).toBe("'default'");
    db.close();
  });

  it('records 003_admin_curation.sql exactly once', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    const rows = (
      db.prepare("SELECT count(*) AS n FROM schema_migrations WHERE filename = '003_admin_curation.sql'").get() as { n: number }
    ).n;
    expect(rows).toBe(1);
    db.close();
  });

  it('adds messages.hidden defaulting to 0', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(messages)').all() as {
      name: string;
      dflt_value: string | null;
    }[];
    expect(cols.find((c) => c.name === 'hidden')?.dflt_value).toBe('0');
    db.close();
  });

  it('records 004_message_curation.sql exactly once', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    const n = (
      db
        .prepare("SELECT count(*) AS n FROM schema_migrations WHERE filename = '004_message_curation.sql'")
        .get() as { n: number }
    ).n;
    expect(n).toBe(1);
    db.close();
  });
});
