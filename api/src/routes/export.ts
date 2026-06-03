import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ExportJobManager } from '../lib/exportJob.js';

export function registerExportRoutes(
  app: FastifyInstance,
  requireAdmin: preHandlerHookHandler,
  manager: ExportJobManager,
  config: { renderUrl: string; outDir: string },
): void {
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/admin/export',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { started, job } = manager.start({
        renderUrl: config.renderUrl,
        outDir: config.outDir,
        eventId: req.params.id,
      });
      if (!started) return reply.code(409).send(job);
      return job;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/events/:id/admin/export',
    { preHandler: requireAdmin },
    async () => manager.get(),
  );
}
