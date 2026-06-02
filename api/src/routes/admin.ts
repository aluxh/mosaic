import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { DB } from '../db/index.js';
import {
  getEvent,
  listAdminPhotos,
  setPhotoHidden,
  deletePhotoCascade,
  updateTransitionStyle,
  listAdminMessages,
  setMessageHidden,
  deleteMessage,
  getPhotoForEvent,
  updatePhotoFocalPoint,
} from '../db/queries.js';
import { detectFocalPoint } from '../lib/focalPoint.js';
import {
  publicUrlForPhoto,
  publicUrlForVariant,
  uploadsDirFor,
  seedsDirFor,
  variantsDirFor,
  type StoragePaths,
} from '../lib/storage.js';
import { safeFilename } from '../lib/pathSafety.js';
import { variantFilename, VARIANT_WIDTHS } from '../lib/variants.js';
import type { LiveUpdateBus } from '../lib/liveUpdates.js';
import type { PhotoRow, TransitionStyle } from '../types.js';

const VALID_STYLES: TransitionStyle[] = ['default', 'cinematic'];

function isUnitNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

// Remove a file inside `dir` named `filename`, refusing any path that escapes
// `dir`. Missing files are ignored (idempotent delete).
function removeContained(dir: string, filename: string): void {
  const root = path.resolve(dir);
  const target = path.resolve(root, filename);
  if (target !== path.join(root, filename) || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('unsafe path');
  }
  if (fs.existsSync(target)) fs.rmSync(target);
}

function removePhotoFiles(paths: StoragePaths, eventId: string, row: PhotoRow): void {
  const filename = safeFilename(row.filename); // throws on traversal attempts
  const originalDir = row.source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
  removeContained(originalDir, filename);
  const vdir = variantsDirFor(paths, eventId);
  for (const width of VARIANT_WIDTHS) {
    removeContained(vdir, variantFilename(filename, width));
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  db: DB,
  paths: StoragePaths,
  requireAdmin: preHandlerHookHandler,
  liveUpdates?: LiveUpdateBus,
): void {
  app.get<{ Params: { id: string } }>(
    '/api/events/:id/admin/photos',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });
      return listAdminPhotos(db, req.params.id).map((p) => ({
        ...p,
        url: publicUrlForPhoto(p.source, p.event_id, p.filename),
        url_1024: publicUrlForVariant(p.event_id, p.filename, 1024),
        url_320: publicUrlForVariant(p.event_id, p.filename, 320),
      }));
    },
  );

  app.patch<{ Params: { id: string; photoId: string }; Body: { hidden?: boolean } }>(
    '/api/events/:id/admin/photos/:photoId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const updated = setPhotoHidden(db, req.params.id, req.params.photoId, Boolean(req.body?.hidden));
      if (!updated) return reply.code(404).send({ error: 'photo not found' });
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string; photoId: string }; Body: { focal_x?: unknown; focal_y?: unknown } }>(
    '/api/events/:id/admin/photos/:photoId/focal',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { focal_x, focal_y } = req.body ?? {};
      if (!isUnitNumber(focal_x) || !isUnitNumber(focal_y)) {
        return reply.code(400).send({ error: 'focal_x and focal_y must be numbers in 0..1' });
      }
      const updated = updatePhotoFocalPoint(db, req.params.id, req.params.photoId, focal_x, focal_y, 'manual');
      if (!updated) return reply.code(404).send({ error: 'photo not found' });
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string; photoId: string } }>(
    '/api/events/:id/admin/photos/:photoId/focal/recalculate',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const row = getPhotoForEvent(db, req.params.id, req.params.photoId);
      if (!row) return reply.code(404).send({ error: 'photo not found' });
      const sourceDir = row.source === 'seed' ? seedsDirFor(paths, req.params.id) : uploadsDirFor(paths, req.params.id);
      const originalPath = path.join(sourceDir, safeFilename(row.filename));
      if (!fs.existsSync(originalPath)) return reply.code(404).send({ error: 'original not found' });
      const focal = await detectFocalPoint(fs.readFileSync(originalPath));
      updatePhotoFocalPoint(db, req.params.id, req.params.photoId, focal.focal_x, focal.focal_y, focal.source);
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true, focal_x: focal.focal_x, focal_y: focal.focal_y, focal_source: focal.source };
    },
  );

  app.delete<{ Params: { id: string; photoId: string } }>(
    '/api/events/:id/admin/photos/:photoId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const deleted = deletePhotoCascade(db, req.params.id, req.params.photoId);
      if (!deleted) return reply.code(404).send({ error: 'photo not found' });
      removePhotoFiles(paths, req.params.id, deleted);
      liveUpdates?.publish({ type: 'photo_deleted', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/events/:id/admin/messages',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });
      return listAdminMessages(db, req.params.id);
    },
  );

  app.patch<{ Params: { id: string; messageId: string }; Body: { hidden?: boolean } }>(
    '/api/events/:id/admin/messages/:messageId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const updated = setMessageHidden(db, req.params.id, req.params.messageId, Boolean(req.body?.hidden));
      if (!updated) return reply.code(404).send({ error: 'message not found' });
      liveUpdates?.publish({ type: 'message_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; messageId: string } }>(
    '/api/events/:id/admin/messages/:messageId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const deleted = deleteMessage(db, req.params.id, req.params.messageId);
      if (!deleted) return reply.code(404).send({ error: 'message not found' });
      liveUpdates?.publish({ type: 'message_deleted', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string }; Body: { transitionStyle?: string } }>(
    '/api/events/:id/admin/settings',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const style = req.body?.transitionStyle;
      if (!style || !VALID_STYLES.includes(style as TransitionStyle)) {
        return reply.code(400).send({ error: 'invalid transitionStyle' });
      }
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });
      updateTransitionStyle(db, req.params.id, style);
      liveUpdates?.publish({ type: 'event_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );
}
