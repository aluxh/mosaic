import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, insertMessage } from '../db/queries.js';
import { newId } from '../lib/ids.js';
import type { LiveUpdateBus } from '../lib/liveUpdates.js';

interface PostBody {
  name?: string;
  text?: string;
}

export function registerMessageRoutes(
  app: FastifyInstance,
  db: DB,
  requireToken: preHandlerHookHandler,
  liveUpdates?: LiveUpdateBus,
): void {
  app.post<{ Params: { id: string }; Body: PostBody }>(
    '/api/events/:id/messages',
    { preHandler: requireToken },
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });

      const body = req.body ?? {};
      const text = (body.text ?? '').trim();
      if (!text) return reply.code(400).send({ error: 'text is required' });
      if (text.length > 240) return reply.code(400).send({ error: 'text too long (max 240)' });

      const name = (body.name ?? '').trim() || 'A friend';
      const createdAt = Date.now();
      const created = insertMessage(db, {
        id: newId(),
        event_id: req.params.id,
        name,
        text,
        created_at: createdAt,
      });
      liveUpdates?.publish({ type: 'message_created', eventId: req.params.id, createdAt });
      return reply.code(201).send(created);
    },
  );
}
