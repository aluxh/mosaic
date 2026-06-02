export type Mode = 'celebration' | 'remembrance';
export type TransitionStyle = 'default' | 'cinematic';
export type FocalSource = 'unknown' | 'detected' | 'fallback' | 'manual';

export interface Event {
  id: string;
  mode: Mode;
  eyebrow: string;
  title: string;
  dateline: string;
  place: string;
  invitation: string;
  brandSub: string;
  shortCode: string;
  transitionStyle: TransitionStyle;
}

export interface Photo {
  id: string;
  eventId: string;
  source: 'seed' | 'upload';
  url: string;
  url1024: string;
  url320: string;
  credit: string;
  createdAt: number;
  focalX: number;
  focalY: number;
}

export interface Message {
  id: string;
  eventId: string;
  name: string;
  text: string;
  createdAt: number;
  photoId: string | null;
}

export interface AdminPhoto extends Photo {
  hidden: boolean;
  focalSource: FocalSource;
}

export interface AdminMessage extends Message {
  hidden: boolean;
}

export type SlideSpec =
  | { id: string; type: 'title-card'; event: Event }
  | { id: string; type: 'hero'; photos: [Photo] }
  | { id: string; type: 'hero-msg'; photos: [Photo]; message: Message | null }
  | { id: string; type: 'duo'; photos: [Photo, Photo] }
  | { id: string; type: 'triptych'; photos: [Photo, Photo, Photo] }
  | { id: string; type: 'polaroid'; photos: [Photo, Photo, Photo] }
  | { id: string; type: 'message'; message: Message };
