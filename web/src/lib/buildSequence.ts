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

  if (event) {
    seq.push({ id: 'title-0', type: 'title-card', event });
  }

  const targetPhotos = photos.length;
  const targetMsgs = messages.length;
  let pi = 0;
  let mi = 0;
  let ti = 0;
  let photosUsed = 0;
  let msgsUsed = 0;
  let safety = 0;

  while ((photosUsed < targetPhotos || msgsUsed < targetMsgs) && safety < MAX_ITERATIONS) {
    safety += 1;

    if (event && ti > 0 && ti % pattern.length === 0) {
      seq.push({ id: `title-${ti}`, type: 'title-card', event });
    }

    const token = pattern[ti % pattern.length]!;
    const p = (k: number): Photo => photos[(pi + k) % photos.length]!;
    const m = (): Message | null => (messages.length > 0 ? messages[mi % messages.length]! : null);

    if (token === 'hero') {
      seq.push({ id: `s${ti}-${p(0).id}`, type: 'hero', photos: [p(0)] });
      pi += 1;
      photosUsed += 1;
    } else if (token === 'duo') {
      seq.push({
        id: `s${ti}-${p(0).id}-${p(1).id}`,
        type: 'duo',
        photos: [p(0), p(1)],
      });
      pi += 2;
      photosUsed += 2;
    } else if (token === 'triptych') {
      seq.push({
        id: `s${ti}-${p(0).id}-${p(1).id}-${p(2).id}`,
        type: 'triptych',
        photos: [p(0), p(1), p(2)],
      });
      pi += 3;
      photosUsed += 3;
    } else if (token === 'polaroid') {
      seq.push({
        id: `s${ti}-${p(0).id}-${p(1).id}-${p(2).id}-pol`,
        type: 'polaroid',
        photos: [p(0), p(1), p(2)],
      });
      pi += 3;
      photosUsed += 3;
    } else if (token === 'hero-msg') {
      const msg = m();
      seq.push({
        id: `s${ti}-${p(0).id}-msg`,
        type: 'hero-msg',
        photos: [p(0)],
        message: msg,
      });
      pi += 1;
      photosUsed += 1;
      if (msg) {
        mi += 1;
        msgsUsed += 1;
      }
    } else {
      const msg = m();
      if (msg) {
        seq.push({
          id: `s${ti}-msg-${msg.id}`,
          type: 'message',
          message: msg,
          photo: p(0),
        });
        mi += 1;
        msgsUsed += 1;
      } else {
        seq.push({ id: `s${ti}-${p(0).id}-fb`, type: 'hero', photos: [p(0)] });
        pi += 1;
        photosUsed += 1;
      }
    }

    ti += 1;
  }

  return seq;
}
