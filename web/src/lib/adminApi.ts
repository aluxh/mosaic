import type { AdminMessage, AdminPhoto, FocalSource, TransitionStyle } from '../types';

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
  focal_x?: number;
  focal_y?: number;
  focal_source?: FocalSource;
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
  focalX: p.focal_x ?? 0.5,
  focalY: p.focal_y ?? 0.5,
  focalSource: p.focal_source ?? 'unknown',
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

export async function updatePhotoFocal(
  eventId: string,
  photoId: string,
  focalX: number,
  focalY: number,
  token: string,
): Promise<void> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}/focal`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ focal_x: focalX, focal_y: focalY }),
  }), url);
}

export async function recalculatePhotoFocal(
  eventId: string,
  photoId: string,
  token: string,
): Promise<{ focalX: number; focalY: number; focalSource: FocalSource }> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}/focal/recalculate`;
  const res = await ensureOk(await fetch(url, { method: 'POST', headers: authHeaders(token) }), url);
  const data = (await res.json()) as { focal_x: number; focal_y: number; focal_source: FocalSource };
  return { focalX: data.focal_x, focalY: data.focal_y, focalSource: data.focal_source };
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

export interface ExportStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: number;
  framesDone?: number;
  totalFrames?: number;
  finishedAt?: number;
  outputUrl?: string;
  error?: string;
}

export async function startExport(eventId: string, token: string): Promise<ExportStatus> {
  const url = `/api/events/${eventId}/admin/export`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(token) });
  // 409 means a render is already running — its body is a valid status, not an error.
  if (res.status === 409) return (await res.json()) as ExportStatus;
  await ensureOk(res, url);
  return (await res.json()) as ExportStatus;
}

export async function getExportStatus(eventId: string, token: string): Promise<ExportStatus> {
  const url = `/api/events/${eventId}/admin/export`;
  const res = await ensureOk(await fetch(url, { headers: authHeaders(token) }), url);
  return (await res.json()) as ExportStatus;
}
