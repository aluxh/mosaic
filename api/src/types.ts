export type Mode = 'celebration' | 'remembrance';
export type PhotoSource = 'seed' | 'upload';
export type FocalSource = 'unknown' | 'detected' | 'fallback' | 'manual';
export type TransitionStyle = 'default' | 'cinematic';

export interface EventRow {
  id: string;
  mode: Mode;
  eyebrow: string;
  title: string;
  dateline: string;
  place: string;
  invitation: string;
  brand_sub: string;
  short_code: string;
  transition_style: string;
}

export interface PhotoRow {
  id: string;
  event_id: string;
  source: PhotoSource;
  filename: string;
  credit: string;
  created_at: number;
  hidden: number;
  focal_x: number;
  focal_y: number;
  focal_source: FocalSource;
}

export interface MessageRow {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
  photo_id: string | null;
  hidden: number;
}

export interface PhotoResponse extends PhotoRow {
  url: string;
  url_1024: string;
  url_320: string;
}
