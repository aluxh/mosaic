import type { AdminMessage, AdminPhoto, TransitionStyle } from '../types';

interface ApiAdminPhoto {
  id: string;
  event_id: string;
  source: AdminPhoto['source'];
  url: string;
  url_1024: string;
  url_320: string;
  credit: string;
  created_at: number;
  hidden: number;
}

const toAdminPhoto = (p: ApiAdminPhoto): AdminPhoto => ({
  id: p.id,
  eventId: p.event_id,
  source: p.source,
  url: p.url,
  url1024: p.url_1024,
  url320: p.url_320,
  credit: p.credit,
  createdAt: p.created_at,
  hidden: p.hidden === 1,
});

interface ApiAdminMessage {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
  photo_id: string | null;
  hidden: number;
}

const toAdminMessage = (m: ApiAdminMessage): AdminMessage => ({
  id: m.id,
  eventId: m.event_id,
  name: m.name,
  text: m.text,
  createdAt: m.created_at,
  photoId: m.photo_id,
  hidden: m.hidden === 1,
});

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function ensureOk(res: Response, url: string): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${url} -> ${res.status}`);
  }
  return res;
}

export async function fetchAdminPhotos(eventId: string, token: string): Promise<AdminPhoto[]> {
  const url = `/api/events/${eventId}/admin/photos`;
  const res = await ensureOk(await fetch(url, { headers: authHeaders(token) }), url);
  const data = (await res.json()) as ApiAdminPhoto[];
  return data.map(toAdminPhoto);
}

export async function setPhotoHidden(eventId: string, photoId: string, hidden: boolean, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ hidden }),
  }), url);
}

export async function deletePhoto(eventId: string, photoId: string, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}`;
  await ensureOk(await fetch(url, { method: 'DELETE', headers: authHeaders(token) }), url);
}

export async function setTransitionStyle(eventId: string, transitionStyle: TransitionStyle, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/settings`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ transitionStyle }),
  }), url);
}

export async function fetchAdminMessages(eventId: string, token: string): Promise<AdminMessage[]> {
  const url = `/api/events/${eventId}/admin/messages`;
  const res = await ensureOk(await fetch(url, { headers: authHeaders(token) }), url);
  const data = (await res.json()) as ApiAdminMessage[];
  return data.map(toAdminMessage);
}

export async function setMessageHidden(eventId: string, messageId: string, hidden: boolean, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/messages/${messageId}`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ hidden }),
  }), url);
}

export async function deleteMessage(eventId: string, messageId: string, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/messages/${messageId}`;
  await ensureOk(await fetch(url, { method: 'DELETE', headers: authHeaders(token) }), url);
}
