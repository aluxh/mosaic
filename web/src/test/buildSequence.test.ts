import { describe, it, expect } from 'vitest';
import { buildSequence } from '../lib/buildSequence';
import type { Event, Photo, Message } from '../types';

const event: Event = {
  id: 'celebration',
  mode: 'celebration',
  eyebrow: 'The wedding of',
  title: 'Lina & Marco',
  dateline: 'Saturday · September 14, 2025',
  place: 'Topanga Canyon, California',
  invitation: 'Drop a photo. Leave a note. Stay a while.',
  brandSub: 'Lina & Marco · Sept 14',
  shortCode: '4F8K',
};

const remembranceEvent: Event = { ...event, id: 'remembrance', mode: 'remembrance' };

const makePhotos = (n: number): Photo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    eventId: 'celebration',
    source: 'seed',
    url: `/data/seeds/celebration/p${i + 1}.jpg`,
    url1024: `/data/variants/celebration/p${i + 1}-1024.jpg`,
    url320: `/data/variants/celebration/p${i + 1}-320.jpg`,
    credit: `Guest ${i + 1}`,
    createdAt: 1000 + i,
  }));

const makeMessages = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    eventId: 'celebration',
    name: `Friend ${i + 1}`,
    text: `Message ${i + 1}`,
    createdAt: 2000 + i,
    photoId: null,
  }));

const makeLinkedMessages = (photos: Photo[]): Message[] =>
  photos.map((p, i) => ({
    id: `lm${i + 1}`,
    eventId: 'celebration',
    name: `Author ${i + 1}`,
    text: `Linked ${i + 1}`,
    createdAt: 3000 + i,
    photoId: p.id,
  }));

describe('buildSequence', () => {
  it('returns empty array when there are no photos', () => {
    expect(buildSequence([], [], 'celebration', event)).toEqual([]);
  });

  it('leads with a title card when photos exist', () => {
    const seq = buildSequence(makePhotos(1), [], 'celebration', event);
    expect(seq[0]?.type).toBe('title-card');
  });

  it('a single photo + no messages produces title card + at least one hero', () => {
    const seq = buildSequence(makePhotos(1), [], 'celebration', event);
    expect(seq.length).toBeGreaterThanOrEqual(2);
    expect(seq[0]?.type).toBe('title-card');
    expect(seq.some((s) => s.type === 'hero')).toBe(true);
  });

  it('celebration pattern includes all six photo/message template types when inputs are plentiful', () => {
    const seq = buildSequence(makePhotos(20), makeMessages(10), 'celebration', event);
    const types = new Set(seq.map((s) => s.type));
    for (const t of ['hero', 'duo', 'triptych', 'polaroid', 'hero-msg', 'message']) {
      expect(types.has(t as any)).toBe(true);
    }
  });

  it('remembrance pattern does NOT include triptych or polaroid templates', () => {
    const seq = buildSequence(makePhotos(20), makeMessages(10), 'remembrance', remembranceEvent);
    const types = new Set(seq.map((s) => s.type));
    expect(types.has('triptych' as any)).toBe(false);
    expect(types.has('polaroid' as any)).toBe(false);
    expect(types.has('hero')).toBe(true);
    expect(types.has('hero-msg')).toBe(true);
    expect(types.has('message')).toBe(true);
  });

  it('title card recurs once per full pattern cycle', () => {
    const seq = buildSequence(makePhotos(60), makeMessages(30), 'celebration', event);
    const titleCount = seq.filter((s) => s.type === 'title-card').length;
    expect(titleCount).toBeGreaterThanOrEqual(2);
  });

  it('each slide has a unique id', () => {
    const seq = buildSequence(makePhotos(20), makeMessages(10), 'celebration', event);
    const ids = seq.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('terminates (no infinite loop) even with imbalanced inputs', () => {
    const seq = buildSequence(makePhotos(3), makeMessages(50), 'celebration', event);
    expect(seq.length).toBeGreaterThan(0);
    expect(seq.length).toBeLessThan(300);
  });

  it('falls back to hero when a message slot has no messages available', () => {
    const seq = buildSequence(makePhotos(20), [], 'celebration', event);
    // With no messages, message + hero-msg slots fall through to hero-only content
    expect(seq.some((s) => s.type === 'hero')).toBe(true);
    // hero-msg may still appear with message: null
    const heroMsg = seq.find((s) => s.type === 'hero-msg');
    if (heroMsg && heroMsg.type === 'hero-msg') {
      expect(heroMsg.message).toBeNull();
    }
  });
});

describe('buildSequence — pairing', () => {
  it('a linked message renders only with its own photo, as hero-msg', () => {
    const photos = makePhotos(6);
    const linked = makeLinkedMessages([photos[0]!]); // photoId === 'c1'
    const seq = buildSequence(photos, linked, 'celebration', event);
    const c1Slides = seq.filter(
      (s) => 'photos' in s && s.photos.some((p) => p.id === 'c1'),
    );
    expect(c1Slides.length).toBeGreaterThan(0);
    for (const s of c1Slides) {
      expect(s.type).toBe('hero-msg');
      expect((s as { message?: Message }).message?.id).toBe('lm1');
    }
    const carriers = seq.filter((s) => (s as { message?: Message }).message?.id === 'lm1');
    for (const s of carriers) {
      expect((s as { photos: Photo[] }).photos[0]!.id).toBe('c1');
    }
  });

  it('a hero-msg slide never carries a foreign message', () => {
    const photos = makePhotos(6);
    const linked = makeLinkedMessages([photos[0]!, photos[1]!]);
    const seq = buildSequence(photos, linked, 'celebration', event);
    const owner = new Map(linked.map((m) => [m.photoId, m.id]));
    for (const s of seq) {
      if (s.type === 'hero-msg') {
        const msg = (s as { message: Message | null }).message;
        if (msg) expect(msg.id).toBe(owner.get((s as { photos: Photo[] }).photos[0]!.id));
      }
    }
  });

  it('standalone messages render as message slides with no photo', () => {
    const seq = buildSequence(makePhotos(6), makeMessages(3), 'celebration', event);
    const msgSlides = seq.filter((s) => s.type === 'message');
    expect(msgSlides.length).toBeGreaterThan(0);
    for (const s of msgSlides) expect('photo' in s).toBe(false);
  });

  it('paired photos never appear in duo/triptych/polaroid', () => {
    const photos = makePhotos(8);
    const linked = makeLinkedMessages([photos[0]!, photos[1]!]);
    const seq = buildSequence(photos, linked, 'celebration', event);
    const linkedIds = new Set(linked.map((m) => m.photoId));
    for (const s of seq) {
      if (s.type === 'duo' || s.type === 'triptych' || s.type === 'polaroid') {
        for (const p of (s as { photos: Photo[] }).photos) {
          expect(linkedIds.has(p.id)).toBe(false);
        }
      }
    }
  });

  it('covers every photo and every standalone message', () => {
    const photos = makePhotos(9);
    const linked = makeLinkedMessages([photos[0]!, photos[1]!]);
    const standalone = makeMessages(3);
    const seq = buildSequence(photos, [...linked, ...standalone], 'celebration', event);
    const shownPhotos = new Set<string>();
    const shownMsgs = new Set<string>();
    for (const s of seq) {
      if ('photos' in s) s.photos.forEach((p) => shownPhotos.add(p.id));
      if (s.type === 'message') shownMsgs.add((s as { message: Message }).message.id);
      if (s.type === 'hero-msg') {
        const m = (s as { message: Message | null }).message;
        if (m) shownMsgs.add(m.id);
      }
    }
    photos.forEach((p) => expect(shownPhotos.has(p.id)).toBe(true));
    standalone.forEach((m) => expect(shownMsgs.has(m.id)).toBe(true));
  });
});
