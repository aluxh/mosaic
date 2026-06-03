import { useEffect, useState } from 'react';
import { Wall } from './components/Wall';
import { fetchEvents, fetchPhotos, fetchMessages } from './lib/api';
import type { Event, Message, Photo } from './types';

// Slides-only page used by the server-side video exporter (`?render=1`).
// One frozen snapshot, no chrome, no live polling.
export function RenderApp() {
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const events = await fetchEvents();
      const ev = events[0];
      if (!ev || cancelled) return;
      const [p, m] = await Promise.all([fetchPhotos(ev.id), fetchMessages(ev.id)]);
      if (cancelled) return;
      setEvent(ev);
      setPhotos(p);
      setMessages(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!event) return null;

  return (
    <div
      className={`fixed inset-0 ${event.mode === 'celebration' ? 'mode-celebration' : 'mode-remembrance'}`}
    >
      <Wall photos={photos} messages={messages} mode={event.mode} paused={false} event={event} renderMode />
    </div>
  );
}
