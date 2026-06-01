import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, mintToken, formatBootToken, type TokenPayload } from '../src/lib/token.js';

const SECRET = 'unit-test-secret';
const futurePayload: TokenPayload = { eid: 'remembrance', exp: 4_102_444_800 }; // year 2100

describe('signToken / verifyToken', () => {
  it('round-trips a freshly signed token', () => {
    const token = signToken(futurePayload, SECRET);
    const result = verifyToken(token, SECRET, 'remembrance');
    expect(result).toEqual({ ok: true, payload: futurePayload });
  });

  it('rejects a tampered payload segment with bad_signature', () => {
    const token = signToken(futurePayload, SECRET);
    const [seg1, sig] = token.split('.');
    const flipped = (seg1![0] === 'A' ? 'B' : 'A') + seg1!.slice(1);
    const result = verifyToken(`${flipped}.${sig}`, SECRET, 'remembrance');
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered signature segment with bad_signature', () => {
    const token = signToken(futurePayload, SECRET);
    const [seg1, sig] = token.split('.');
    const flipped = (sig![0] === 'A' ? 'B' : 'A') + sig!.slice(1);
    const result = verifyToken(`${seg1}.${flipped}`, SECRET, 'remembrance');
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects verification under a different secret with bad_signature', () => {
    const token = signToken(futurePayload, SECRET);
    expect(verifyToken(token, 'other-secret', 'remembrance')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token (now injected)', () => {
    const token = signToken({ eid: 'remembrance', exp: 1000 }, SECRET);
    const result = verifyToken(token, SECRET, 'remembrance', 2000);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token minted for a different event with wrong_event', () => {
    const token = signToken({ eid: 'celebration', exp: 4_102_444_800 }, SECRET);
    const result = verifyToken(token, SECRET, 'remembrance');
    expect(result).toEqual({ ok: false, reason: 'wrong_event' });
  });

  it('rejects a token with no dot as malformed', () => {
    expect(verifyToken('garbage', SECRET, 'remembrance')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects empty segments as malformed', () => {
    expect(verifyToken('.abc', SECRET, 'remembrance')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('abc.', SECRET, 'remembrance')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a non-JSON payload with a valid-looking (but wrong) signature as bad_signature', () => {
    // Signature is checked before JSON.parse, so an unsigned non-JSON payload fails on signature.
    const seg1 = Buffer.from('not json').toString('base64url');
    const fakeSig = Buffer.from('deadbeef').toString('base64url');
    expect(verifyToken(`${seg1}.${fakeSig}`, SECRET, 'remembrance')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('does not throw on a length-mismatched signature (constant-time path)', () => {
    const token = signToken(futurePayload, SECRET);
    const [seg1] = token.split('.');
    expect(() => verifyToken(`${seg1}.x`, SECRET, 'remembrance')).not.toThrow();
    expect(verifyToken(`${seg1}.x`, SECRET, 'remembrance')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('mintToken', () => {
  const SECRET = 'unit-test-secret';

  it('produces a token that verifies for its event', () => {
    const nowMs = 1_700_000_000_000;
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 14, now: nowMs });
    const result = verifyToken(r.token, SECRET, 'remembrance', Math.floor(nowMs / 1000));
    expect(result.ok).toBe(true);
  });

  it('sets exp to floor(now/1000) + ttlDays*86400', () => {
    const nowMs = 1_700_000_000_000;
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 14, now: nowMs });
    const decoded = verifyToken(r.token, SECRET, 'remembrance', Math.floor(nowMs / 1000));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload.exp).toBe(Math.floor(nowMs / 1000) + 14 * 86400);
  });

  it('builds the QR url from baseUrl when provided', () => {
    const r = mintToken({
      secret: SECRET,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://event.example',
      now: 1_700_000_000_000,
    });
    expect(r.url).toBe(`https://event.example/#t=${r.token}`);
  });

  it('uses a placeholder host when baseUrl is absent', () => {
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 14, now: 1_700_000_000_000 });
    expect(r.url).toBe(`https://<your-event-host>/#t=${r.token}`);
  });

  it('returns an ISO-8601 expiresAt', () => {
    const nowMs = 1_700_000_000_000;
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 1, now: nowMs });
    expect(r.expiresAt).toBe(new Date((Math.floor(nowMs / 1000) + 86400) * 1000).toISOString());
  });
});

describe('formatBootToken', () => {
  const result = mintToken({
    secret: 'test-secret',
    eid: 'remembrance',
    ttlDays: 14,
    baseUrl: 'https://event.example.com',
    now: 1_700_000_000_000,
  });

  it('includes a URL line when baseUrl is set', () => {
    const lines = formatBootToken(result, 'https://event.example.com');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('✓ Token minted');
    expect(lines.some((l) => l.includes(result.token))).toBe(true);
    expect(lines.some((l) => l.includes(result.expiresAt))).toBe(true);
    expect(lines.some((l) => l.includes('URL:') && l.includes(result.url))).toBe(true);
  });

  it('omits the URL line when baseUrl is undefined', () => {
    const lines = formatBootToken(result, undefined);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes('URL:'))).toBe(false);
    expect(lines.some((l) => l.includes(result.token))).toBe(true);
    expect(lines.some((l) => l.includes(result.expiresAt))).toBe(true);
  });

  it('logs a token that verifies for the same secret and event', () => {
    const minted = mintToken({ secret: 'test-secret', eid: 'remembrance', ttlDays: 14 });
    const v = verifyToken(minted.token, 'test-secret', 'remembrance');
    expect(v.ok).toBe(true);
  });
});

describe('admin role claim', () => {
  const secret = 'role-secret';

  it('round-trips a role: admin payload through sign/verify', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signToken({ eid: 'remembrance', exp, role: 'admin' }, secret);
    const res = verifyToken(token, secret, 'remembrance');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.role).toBe('admin');
  });

  it('omits role for a guest token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signToken({ eid: 'remembrance', exp }, secret);
    const res = verifyToken(token, secret, 'remembrance');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.role).toBeUndefined();
  });

  it('mintToken with role: admin produces an /admin#t= URL', () => {
    const result = mintToken({
      secret,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://ev.example',
      role: 'admin',
    });
    expect(result.url).toBe(`https://ev.example/admin#t=${result.token}`);
  });

  it('mintToken without role keeps the guest /#t= URL', () => {
    const result = mintToken({
      secret,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://ev.example',
    });
    expect(result.url).toBe(`https://ev.example/#t=${result.token}`);
  });

  it('mintToken handles baseUrl with trailing slash for admin', () => {
    const result = mintToken({
      secret,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://ev.example/',
      role: 'admin',
    });
    expect(result.url).toBe(`https://ev.example/admin#t=${result.token}`);
  });

  it('mintToken handles baseUrl with trailing slash for guest', () => {
    const result = mintToken({
      secret,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://ev.example/',
    });
    expect(result.url).toBe(`https://ev.example/#t=${result.token}`);
  });
});
