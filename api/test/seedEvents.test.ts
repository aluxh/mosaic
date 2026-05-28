import { describe, it, expect, afterEach } from 'vitest';
import { applyEventOverrides, SEED_EVENTS } from '../src/lib/seedEvents.js';

const seed = SEED_EVENTS.remembrance;

afterEach(() => {
  for (const key of [
    'EVENT_TITLE',
    'EVENT_EYEBROW',
    'EVENT_DATELINE',
    'EVENT_PLACE',
    'EVENT_INVITATION',
    'EVENT_BRAND_SUB',
    'EVENT_SHORT_CODE',
  ]) {
    delete process.env[key];
  }
});

describe('applyEventOverrides', () => {
  it('returns seed unchanged when no env vars are set', () => {
    expect(applyEventOverrides(seed)).toEqual(seed);
  });

  it('overrides title', () => {
    process.env.EVENT_TITLE = 'Grace Mei Wong';
    expect(applyEventOverrides(seed).title).toBe('Grace Mei Wong');
  });

  it('overrides eyebrow', () => {
    process.env.EVENT_EYEBROW = 'Celebrating the life of';
    expect(applyEventOverrides(seed).eyebrow).toBe('Celebrating the life of');
  });

  it('overrides dateline', () => {
    process.env.EVENT_DATELINE = '1925 — 2026';
    expect(applyEventOverrides(seed).dateline).toBe('1925 — 2026');
  });

  it('overrides place', () => {
    process.env.EVENT_PLACE = 'Hong Kong, 1925';
    expect(applyEventOverrides(seed).place).toBe('Hong Kong, 1925');
  });

  it('overrides invitation', () => {
    process.env.EVENT_INVITATION = 'Leave a note for the family.';
    expect(applyEventOverrides(seed).invitation).toBe('Leave a note for the family.');
  });

  it('overrides brand_sub', () => {
    process.env.EVENT_BRAND_SUB = 'In remembrance · Grace';
    expect(applyEventOverrides(seed).brand_sub).toBe('In remembrance · Grace');
  });

  it('overrides short_code', () => {
    process.env.EVENT_SHORT_CODE = 'GM26';
    expect(applyEventOverrides(seed).short_code).toBe('GM26');
  });

  it('does not override id or mode even if similarly-named vars are set', () => {
    process.env.EVENT_TITLE = 'Override Me';
    const result = applyEventOverrides(seed);
    expect(result.id).toBe(seed.id);
    expect(result.mode).toBe(seed.mode);
  });

  it('leaves non-overridden fields at their seed values', () => {
    process.env.EVENT_TITLE = 'Grace Mei Wong';
    const result = applyEventOverrides(seed);
    expect(result.eyebrow).toBe(seed.eyebrow);
    expect(result.dateline).toBe(seed.dateline);
    expect(result.place).toBe(seed.place);
    expect(result.invitation).toBe(seed.invitation);
    expect(result.brand_sub).toBe(seed.brand_sub);
    expect(result.short_code).toBe(seed.short_code);
  });

  it('ignores empty-string env vars (treats as unset)', () => {
    process.env.EVENT_TITLE = '';
    expect(applyEventOverrides(seed).title).toBe(seed.title);
  });

  it('does not mutate the input object', () => {
    process.env.EVENT_TITLE = 'Grace Mei Wong';
    const before = { ...seed };
    applyEventOverrides(seed);
    expect(seed.title).toBe(before.title);
  });
});
