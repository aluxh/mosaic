import type { Event, Message, Mode, Photo, SlideSpec } from '../types';

type PatternToken = 'hero' | 'duo' | 'hero-msg' | 'triptych' | 'polaroid' | 'message';

const CELEBRATION_PATTERN: PatternToken[] = [
  'hero',
  'duo',
  'hero-msg',
  'triptych',
  'hero',
  'polaroid',
  'duo',
  'message',
  'hero-msg',
  'hero',
  'duo',
  'message',
];

const REMEMBRANCE_PATTERN: PatternToken[] = [
  'hero',
  'hero-msg',
  'duo',
  'message',
  'hero',
  'duo',
  'hero-msg',
  'hero',
  'message',
];

const MAX_ITERATIONS = 200;

export function buildSequence(
  photos: Photo[],
  messages: Message[],
  mode: Mode,
  event: Event | null,
): SlideSpec[] {
  if (photos.length === 0) return [];

  const pattern = mode === 'celebration' ? CELEBRATION_PATTERN : REMEMBRANCE_PATTERN;
  const seq: SlideSpec[] = [];

  const photoIds = new Set(photos.map((p) => p.id));
  const msgByPhoto = new Map<string, Message>();
  const standalone: Message[] = [];
  for (const m of messages) {
    if (m.photoId && photoIds.has(m.photoId)) msgByPhoto.set(m.photoId, m);
    else standalone.push(m);
  }
  const paired = photos.filter((p) => msgByPhoto.has(p.id));
  const plain = photos.filter((p) => !msgByPhoto.has(p.id));

  if (event) {
    seq.push({ id: 'title-0', type: 'title-card', event });
  }

  let pairedI = 0;
  let plainI = 0;
  let standI = 0;
  let pairedUsed = 0;
  let plainUsed = 0;
  let standUsed = 0;
  let ti = 0;
  let safety = 0;

  const nextPaired = (): Photo => {
    const p = paired[pairedI % paired.length]!;
    pairedI += 1;
    if (pairedUsed < paired.length) pairedUsed += 1;
    return p;
  };
  const nextPlain = (): Photo => {
    const p = plain[plainI % plain.length]!;
    plainI += 1;
    if (plainUsed < plain.length) plainUsed += 1;
    return p;
  };
  const nextStandalone = (): Message => {
    const m = standalone[standI % standalone.length]!;
    standI += 1;
    if (standUsed < standalone.length) standUsed += 1;
    return m;
  };

  const emitSingle = (photo: Photo): void => {
    const msg = msgByPhoto.get(photo.id);
    if (msg) {
      seq.push({ id: `s${ti}-${photo.id}-msg`, type: 'hero-msg', photos: [photo], message: msg });
    } else {
      seq.push({ id: `s${ti}-${photo.id}`, type: 'hero', photos: [photo] });
    }
  };

  const done = (): boolean =>
    pairedUsed >= paired.length && plainUsed >= plain.length && standUsed >= standalone.length;

  while (!done() && safety < MAX_ITERATIONS) {
    safety += 1;

    if (event && ti > 0 && ti % pattern.length === 0) {
      seq.push({ id: `title-${ti}`, type: 'title-card', event });
    }

    const token = pattern[ti % pattern.length]!;

    if (token === 'hero') {
      if (plain.length > 0) emitSingle(nextPlain());
      else if (paired.length > 0) emitSingle(nextPaired());
    } else if (token === 'hero-msg') {
      if (paired.length > 0) {
        emitSingle(nextPaired());
      } else if (plain.length > 0) {
        const p = nextPlain();
        seq.push({ id: `s${ti}-${p.id}-msg`, type: 'hero-msg', photos: [p], message: null });
      }
    } else if (token === 'duo') {
      if (plain.length > 0) {
        const a = nextPlain();
        const b = nextPlain();
        seq.push({ id: `s${ti}-${a.id}-${b.id}`, type: 'duo', photos: [a, b] });
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else if (token === 'triptych') {
      if (plain.length > 0) {
        const a = nextPlain();
        const b = nextPlain();
        const c = nextPlain();
        seq.push({ id: `s${ti}-${a.id}-${b.id}-${c.id}`, type: 'triptych', photos: [a, b, c] });
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else if (token === 'polaroid') {
      if (plain.length > 0) {
        const a = nextPlain();
        const b = nextPlain();
        const c = nextPlain();
        seq.push({
          id: `s${ti}-${a.id}-${b.id}-${c.id}-pol`,
          type: 'polaroid',
          photos: [a, b, c],
        });
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else {
      // 'message'
      if (standalone.length > 0) {
        const m = nextStandalone();
        seq.push({ id: `s${ti}-msg-${m.id}`, type: 'message', message: m });
      } else if (plain.length > 0) {
        emitSingle(nextPlain());
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    }

    ti += 1;
  }

  return seq;
}
