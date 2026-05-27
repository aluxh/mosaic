export type Mode = 'celebration' | 'remembrance';

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
}

export interface Photo {
  id: string;
  eventId: string;
  source: 'seed' | 'upload';
  url: string;
  credit: string;
  createdAt: number;
}

export interface Message {
  id: string;
  eventId: string;
  name: string;
  text: string;
  createdAt: number;
}

export type SlideSpec =
  | { id: string; type: 'title-card'; event: Event }
  | { id: string; type: 'hero'; photos: [Photo] }
  | { id: string; type: 'hero-msg'; photos: [Photo]; message: Message | null }
  | { id: string; type: 'duo'; photos: [Photo, Photo] }
  | { id: string; type: 'triptych'; photos: [Photo, Photo, Photo] }
  | { id: string; type: 'polaroid'; photos: [Photo, Photo, Photo] }
  | { id: string; type: 'message'; message: Message; photo: Photo };
