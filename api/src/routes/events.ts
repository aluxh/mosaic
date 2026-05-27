import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, listEvents, listMessages, listPhotos } from '../db/queries.js';
import { publicUrlForPhoto } from '../lib/storage.js';

export function registerEventRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/events', async () => listEvents(db));

  app.get<{ Params: { id: string } }>('/api/events/:id/photos', async (req, reply) => {
    const event = getEvent(db, req.params.id);
    if (!event) return reply.code(404).send({ error: 'event not found' });
    const photos = listPhotos(db, req.params.id);
    return photos.map((p) => ({
      ...p,
      url: publicUrlForPhoto(p.source, p.event_id, p.filename),
    }));
  });

  app.get<{ Params: { id: string } }>('/api/events/:id/messages', async (req, reply) => {
    const event = getEvent(db, req.params.id);
    if (!event) return reply.code(404).send({ error: 'event not found' });
    return listMessages(db, req.params.id);
  });
}
