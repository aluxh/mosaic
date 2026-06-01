import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, insertPhoto, insertMessage } from '../db/queries.js';
import { newId } from '../lib/ids.js';
import {
  publicUrlForPhoto,
  publicUrlForVariant,
  type StoragePaths,
} from '../lib/storage.js';
import { ingestImage, MAX_FILE_BYTES } from '../lib/imageIngest.js';
import { ensureVariants } from '../lib/variants.js';
import { safeEventId } from '../lib/pathSafety.js';
import type { LiveUpdateBus } from '../lib/liveUpdates.js';

export function registerPhotoRoutes(
  app: FastifyInstance,
  db: DB,
  paths: StoragePaths,
  requireToken: preHandlerHookHandler,
  liveUpdates?: LiveUpdateBus,
): void {
  // codeql[js/missing-rate-limiting]
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/photos',
    { preHandler: requireToken },
    async (req, reply) => {
      let eventId: string;
      try {
        eventId = safeEventId(req.params.id);
      } catch {
        return reply.code(404).send({ error: 'event not found' });
      }

      const event = getEvent(db, eventId);
      if (!event) return reply.code(404).send({ error: 'event not found' });

      const parts = req.parts();
      let fileBuf: Buffer | null = null;
      let credit = '';
      let message = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          try {
            fileBuf = await part.toBuffer();
          } catch {
            return reply.code(413).send({ error: 'file too large (max 10MB)' });
          }
        } else if (part.type === 'field' && part.fieldname === 'credit') {
          credit = String(part.value ?? '').trim();
        } else if (part.type === 'field' && part.fieldname === 'message') {
          message = String(part.value ?? '').trim();
        }
      }

      if (!fileBuf) return reply.code(400).send({ error: 'file is required' });
      if (message.length > 240) {
        return reply.code(400).send({ error: 'text too long (max 240)' });
      }

      const result = await ingestImage(fileBuf, MAX_FILE_BYTES);
      if (!result.ok) {
        return reply.code(result.code).send({ error: result.error });
      }

      const id = newId();
      const filename = `${id}${result.ext}`;
      const uploadsRoot = path.resolve(paths.uploadsDir);
      const dir = path.resolve(uploadsRoot, eventId);
      if (!dir.startsWith(`${uploadsRoot}${path.sep}`)) {
        return reply.code(404).send({ error: 'event not found' });
      }
      const target = path.resolve(dir, filename);
      if (!target.startsWith(`${dir}${path.sep}`)) {
        return reply.code(500).send({ error: 'invalid upload path' });
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, result.buf);
      await ensureVariants(paths.variantsDir, eventId, filename, result.buf, result.format);

      const createdAt = Date.now();
      const writePair = db.transaction(() => {
        const photo = insertPhoto(db, {
          id,
          event_id: eventId,
          source: 'upload',
          filename,
          credit: credit || 'Guest',
          created_at: createdAt,
        });
        const msg = message
          ? insertMessage(db, {
              id: newId(),
              event_id: eventId,
              name: credit || 'A friend',
              text: message,
              created_at: createdAt,
              photo_id: id,
            })
          : null;
        return { photo, msg };
      });
      const { photo, msg } = writePair();
      liveUpdates?.publish({ type: 'photo_created', eventId, createdAt });
      if (msg) liveUpdates?.publish({ type: 'message_created', eventId, createdAt });

      return reply.code(201).send({
        ...photo,
        url: publicUrlForPhoto('upload', eventId, filename),
        url_1024: publicUrlForVariant(eventId, filename, 1024),
        url_320: publicUrlForVariant(eventId, filename, 320),
        message: msg,
      });
    },
  );
}
