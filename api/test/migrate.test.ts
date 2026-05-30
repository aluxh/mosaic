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
});
