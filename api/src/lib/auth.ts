import type { preHandlerHookHandler } from 'fastify';
import { verifyToken } from './token.js';

const MISSING_SECRET_MSG = `TOKEN_SECRET is not set. Mosaic v0.3 requires a signing secret for upload
tokens. Set TOKEN_SECRET (a long random string), then run \`npm run
mint-token\` to generate the QR URL guests will scan. See README →
"Capability tokens".`;

const SCAN_MSG = "This link can't be used to upload — scan the QR code at the event.";
const EXPIRED_MSG = 'This event is no longer accepting uploads — ask the host for a new code.';

export function requireTokenSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.TOKEN_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(MISSING_SECRET_MSG);
  }
  return secret;
}

export function makeRequireToken(secret: string): preHandlerHookHandler {
  return async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: SCAN_MSG });
    }
    const token = auth.slice('Bearer '.length);
    const eventId = (req.params as { id: string }).id;
    const result = verifyToken(token, secret, eventId);
    if (!result.ok) {
      const msg = result.reason === 'expired' ? EXPIRED_MSG : SCAN_MSG;
      return reply.code(401).send({ error: msg });
    }
  };
}
