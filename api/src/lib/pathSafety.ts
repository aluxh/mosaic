const EVENT_ID_RE = /^[A-Za-z0-9_-]+$/;
const FILENAME_RE = /^[ A-Za-z0-9._()-]+$/;

export function safeEventId(eventId: string): string {
  if (!EVENT_ID_RE.test(eventId)) {
    throw new Error('unsafe event id');
  }
  return eventId;
}

export function safeFilename(filename: string): string {
  if (filename === '.' || filename === '..' || !FILENAME_RE.test(filename)) {
    throw new Error('unsafe filename');
  }
  return filename;
}
