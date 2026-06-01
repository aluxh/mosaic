import crypto from 'node:crypto';

export interface TokenPayload {
  eid: string;
  exp: number; // unix seconds
  role?: 'admin';
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_event' };

export interface MintResult {
  token: string;
  expiresAt: string; // ISO-8601, for human display
  url: string;       // `${baseUrl}/#t=${token}` or a placeholder if baseUrl absent
}

function hmac(secret: string, segment1: string): string {
  return crypto.createHmac('sha256', secret).update(segment1).digest('base64url');
}

// Constant-time string compare that never throws on length mismatch:
// hash both sides to a fixed 32-byte digest, then timingSafeEqual.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function signToken(payload: TokenPayload, secret: string): string {
  const seg1 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${seg1}.${hmac(secret, seg1)}`;
}

export function verifyToken(
  token: string,
  secret: string,
  eventId: string,
  now: number = Date.now() / 1000,
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed' };
  }
  const [seg1, sig] = parts as [string, string];

  if (!safeEqual(sig, hmac(secret, seg1))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(seg1, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const p = payload as Partial<TokenPayload>;
  if (typeof p.eid !== 'string' || typeof p.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (p.eid !== eventId) return { ok: false, reason: 'wrong_event' };
  if (p.exp <= now) return { ok: false, reason: 'expired' };

  return { ok: true, payload: { eid: p.eid, exp: p.exp, ...(p.role === 'admin' ? { role: 'admin' as const } : {}) } };
}

export function mintToken(opts: {
  secret: string;
  eid: string;
  ttlDays: number;
  baseUrl?: string;
  role?: 'admin';
  now?: number; // unix ms; injectable for tests
}): MintResult {
  const nowMs = opts.now ?? Date.now();
  const exp = Math.floor(nowMs / 1000) + opts.ttlDays * 86400;
  const token = signToken(
    { eid: opts.eid, exp, ...(opts.role ? { role: opts.role } : {}) },
    opts.secret,
  );
  const host = opts.baseUrl ?? 'https://<your-event-host>';
  const path = opts.role === 'admin' ? '/admin#t=' : '/#t=';
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    url: `${host}${path}${token}`,
  };
}

export function formatBootToken(result: MintResult, baseUrl?: string): string[] {
  const lines = [
    '✓ Token minted',
    `  Token:   ${result.token}`,
    `  Expires: ${result.expiresAt}`,
  ];
  if (baseUrl) {
    lines.push(`  URL:     ${result.url}`);
  }
  return lines;
}
