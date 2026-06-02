import type { FastifyInstance } from 'fastify';
import { mintToken } from '../lib/token.js';

export function registerJoinRoute(
  app: FastifyInstance,
  opts: { tokenSecret: string; eventId: string; ttlDays: number; baseUrl?: string },
): void {
  app.get('/join', async (_req, reply) => {
    const { token } = mintToken({
      secret: opts.tokenSecret,
      eid: opts.eventId,
      ttlDays: opts.ttlDays,
      baseUrl: opts.baseUrl,
    });
    const url = opts.baseUrl ? `${opts.baseUrl}/#t=${token}` : `/#t=${token}`;
    return reply.redirect(url);
  });
}
