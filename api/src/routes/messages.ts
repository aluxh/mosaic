import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, insertMessage } from '../db/queries.js';
import { newId } from '../lib/ids.js';

interface PostBody {
  name?: string;
  text?: string;
}

export function registerMessageRoutes(
  app: FastifyInstance,
  db: DB,
  requireToken: preHandlerHookHandler,
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
      const created = insertMessage(db, {
        id: newId(),
        event_id: req.params.id,
        name,
        text,
        created_at: Date.now(),
      });
      return reply.code(201).send(created);
    },
  );
}
