/**
 * Default Fastify `trustProxy` value when TRUST_PROXY is unset. Matches the
 * bundled compose topology: the API is reachable only via the nginx container
 * on the internal Docker bridge, behind an upstream proxy. Trusting loopback +
 * private ranges lets proxy-addr walk the X-Forwarded-For chain nginx sets.
 * Safe only because the API uses `expose` (never `ports`) and is therefore
 * unreachable directly from the internet — enforced by the compose
 * host-network test (Task 6).
 *
 * Operators on other topologies (AWS ALB/Fargate, Heroku, Caddy) override via
 * the TRUST_PROXY env var.
 */
export const DEFAULT_TRUST_PROXY: string[] = [
  'loopback',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
];

export type TrustProxyValue = boolean | number | string[];

/**
 * Map the TRUST_PROXY env string to a Fastify `trustProxy` value:
 *   unset/blank     -> DEFAULT_TRUST_PROXY
 *   "true"/"false"  -> boolean
 *   all-digits      -> number of hops
 *   comma list      -> trimmed IP/CIDR array
 */
export function parseTrustProxy(value: string | undefined): TrustProxyValue {
  const v = value?.trim();
  if (!v) return DEFAULT_TRUST_PROXY;
  const lower = v.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
