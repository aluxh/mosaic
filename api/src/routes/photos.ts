import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, insertPhoto } from '../db/queries.js';
import { newId } from '../lib/ids.js';
import { publicUrlForPhoto, uploadsDirFor, type StoragePaths } from '../lib/storage.js';
import { ingestImage, MAX_FILE_BYTES } from '../lib/imageIngest.js';

export function registerPhotoRoutes(
  app: FastifyInstance,
  db: DB,
  paths: StoragePaths,
): void {
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/photos',
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });

      const parts = req.parts();
      let fileBuf: Buffer | null = null;
      let credit = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          try {
            fileBuf = await part.toBuffer();
          } catch {
            return reply.code(413).send({ error: 'file too large (max 10MB)' });
          }
        } else if (part.type === 'field' && part.fieldname === 'credit') {
          credit = String(part.value ?? '').trim();
        }
      }

      if (!fileBuf) return reply.code(400).send({ error: 'file is required' });

      const result = await ingestImage(fileBuf, MAX_FILE_BYTES);
      if (!result.ok) {
        return reply.code(result.code).send({ error: result.error });
      }

      const id = newId();
      const filename = `${id}${result.ext}`;
      const dir = uploadsDirFor(paths, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), result.buf);

      const row = insertPhoto(db, {
        id,
        event_id: req.params.id,
        source: 'upload',
        filename,
        credit: credit || 'Guest',
        created_at: Date.now(),
      });

      return reply.code(201).send({
        ...row,
        url: publicUrlForPhoto('upload', req.params.id, filename),
      });
    },
  );
}
