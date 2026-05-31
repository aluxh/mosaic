import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

export function makeRateLimiter({ max, windowMs }: RateLimitOptions): preHandlerHookHandler {
  const buckets = new Map<string, Bucket>();

  return (req: FastifyRequest, reply: FastifyReply, done) => {
    const now = Date.now();
    const key = req.ip;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      done();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      reply.code(429).send({ error: 'too many requests' });
      return;
    }

    done();
  };
}
