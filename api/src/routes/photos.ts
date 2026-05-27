import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, insertPhoto } from '../db/queries.js';
import { newId } from '../lib/ids.js';
import { publicUrlForPhoto, uploadsDirFor, type StoragePaths } from '../lib/storage.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

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
      let mime = '';
      let originalName = '';
      let credit = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          mime = part.mimetype;
          originalName = part.filename ?? '';
          fileBuf = await part.toBuffer();
          if (fileBuf.byteLength > MAX_FILE_BYTES) {
            return reply.code(413).send({ error: 'file too large (max 10MB)' });
          }
        } else if (part.type === 'field' && part.fieldname === 'credit') {
          credit = String(part.value ?? '').trim();
        }
      }

      if (!fileBuf) return reply.code(400).send({ error: 'file is required' });
      const ext = EXT_BY_MIME[mime] ?? path.extname(originalName).toLowerCase() ?? '.jpg';
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        return reply.code(415).send({ error: 'unsupported image type' });
      }

      const id = newId();
      const filename = `${id}${ext === '.jpeg' ? '.jpg' : ext}`;
      const dir = uploadsDirFor(paths, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), fileBuf);

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
