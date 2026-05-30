import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, type TokenPayload } from '../src/lib/token.js';

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
