import type { EventRow, Mode } from '../types.js';

const VALID_MODES: ReadonlySet<string> = new Set(['celebration', 'remembrance']);

export function resolveEventMode(): Mode {
  const raw = process.env.EVENT_MODE;
  if (!raw || !VALID_MODES.has(raw)) {
    console.warn(
      `EVENT_MODE ${raw ? `"${raw}" is invalid` : 'is not set'}; defaulting to "celebration". Set EVENT_MODE=celebration or EVENT_MODE=remembrance.`,
    );
    return 'celebration';
  }
  return raw as Mode;
}

export const SEED_EVENTS: Record<Mode, EventRow> = {
  celebration: {
    id: 'celebration',
    mode: 'celebration',
    eyebrow: 'The wedding of',
    title: 'Lina  &  Marco',
    dateline: 'Saturday · September 14, 2025',
    place: 'Topanga Canyon, California',
    invitation: 'Drop a photo. Leave a note. Stay a while.',
    brand_sub: 'Lina & Marco · Sept 14',
    short_code: '4F8K',
  },
  remembrance: {
    id: 'remembrance',
    mode: 'remembrance',
    eyebrow: 'In loving memory of',
    title: 'Theodore James Halloway',
    dateline: 'June 3, 1948  —  May 11, 2025',
    place: 'A service of remembrance',
    invitation: 'Share a memory — a moment, a phrase, a song he loved.',
    brand_sub: 'In remembrance · Theodore',
    short_code: '4F8K',
  },
};

const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
};

export function applyEventOverrides(seed: EventRow): EventRow {
  return {
    ...seed,
    ...(env('EVENT_TITLE') !== undefined && { title: env('EVENT_TITLE')! }),
    ...(env('EVENT_EYEBROW') !== undefined && { eyebrow: env('EVENT_EYEBROW')! }),
    ...(env('EVENT_DATELINE') !== undefined && { dateline: env('EVENT_DATELINE')! }),
    ...(env('EVENT_PLACE') !== undefined && { place: env('EVENT_PLACE')! }),
    ...(env('EVENT_INVITATION') !== undefined && { invitation: env('EVENT_INVITATION')! }),
    ...(env('EVENT_BRAND_SUB') !== undefined && { brand_sub: env('EVENT_BRAND_SUB')! }),
    ...(env('EVENT_SHORT_CODE') !== undefined && { short_code: env('EVENT_SHORT_CODE')! }),
  };
}
