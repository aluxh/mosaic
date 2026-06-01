import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent } from '../db/queries.js';
import type { LiveUpdate, LiveUpdateBus } from '../lib/liveUpdates.js';

export const HEARTBEAT_MS = 25_000;

function writeEvent(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeUpdate(raw: NodeJS.WritableStream, update: LiveUpdate): void {
  writeEvent(raw, 'mosaic-update', update);
}

export function registerStreamRoutes(app: FastifyInstance, db: DB, liveUpdates: LiveUpdateBus): void {
  app.get<{ Params: { id: string } }>('/api/events/:id/stream', (req, reply) => {
    const event = getEvent(db, req.params.id);
    if (!event) return reply.code(404).send({ error: 'event not found' });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    writeEvent(reply.raw, 'ready', {});

    const unsubscribe = liveUpdates.subscribe(req.params.id, (update) => {
      writeUpdate(reply.raw, update);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
