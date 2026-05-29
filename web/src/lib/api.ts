import type { Event, Message, Photo } from '../types';

interface ApiEvent {
  id: string;
  mode: Event['mode'];
  eyebrow: string;
  title: string;
  dateline: string;
  place: string;
  invitation: string;
  brand_sub: string;
  short_code: string;
}

interface ApiPhoto {
  id: string;
  event_id: string;
  source: Photo['source'];
  url: string;
  credit: string;
  created_at: number;
}

interface ApiMessage {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
}

const toEvent = (e: ApiEvent): Event => ({
  id: e.id,
  mode: e.mode,
  eyebrow: e.eyebrow,
  title: e.title,
  dateline: e.dateline,
  place: e.place,
  invitation: e.invitation,
  brandSub: e.brand_sub,
  shortCode: e.short_code,
});

const toPhoto = (p: ApiPhoto): Photo => ({
  id: p.id,
  eventId: p.event_id,
  source: p.source,
  url: p.url,
  credit: p.credit,
  createdAt: p.created_at,
});

const toMessage = (m: ApiMessage): Message => ({
  id: m.id,
  eventId: m.event_id,
  name: m.name,
  text: m.text,
  createdAt: m.created_at,
});

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchEvents(): Promise<Event[]> {
  const data = await getJson<ApiEvent[]>('/api/events');
  return data.map(toEvent);
}

export async function fetchPhotos(eventId: string): Promise<Photo[]> {
  const data = await getJson<ApiPhoto[]>(`/api/events/${eventId}/photos`);
  return data.map(toPhoto);
}

export async function fetchMessages(eventId: string): Promise<Message[]> {
  const data = await getJson<ApiMessage[]>(`/api/events/${eventId}/messages`);
  return data.map(toMessage);
}

export async function uploadPhoto(
  eventId: string,
  file: File,
  credit?: string,
): Promise<Photo> {
  const fd = new FormData();
  fd.append('file', file);
  if (credit) fd.append('credit', credit);
  const res = await fetch(`/api/events/${eventId}/photos`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Upload failed');
  }
  return toPhoto((await res.json()) as ApiPhoto);
}

export async function postMessage(
  eventId: string,
  body: { name?: string; text: string },
): Promise<Message> {
  const res = await fetch(`/api/events/${eventId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`message -> ${res.status}`);
  return toMessage((await res.json()) as ApiMessage);
}
