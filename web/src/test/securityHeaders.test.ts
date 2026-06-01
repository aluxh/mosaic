// web/src/test/securityHeaders.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const snippet = readFileSync(path.join(repoRoot, 'nginx-security-headers.conf'), 'utf-8');
const nginxConf = readFileSync(path.join(repoRoot, 'nginx.conf'), 'utf-8');

describe('nginx security headers', () => {
  it('declares all required response headers', () => {
    for (const header of [
      'Content-Security-Policy',
      'X-Content-Type-Options "nosniff"',
      'Referrer-Policy',
      'X-Frame-Options',
      'Permissions-Policy',
    ]) {
      expect(snippet).toContain(header);
    }
  });

  it('declares the key CSP directives', () => {
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(snippet).toContain(directive);
    }
  });

  it('includes the snippet in both the SPA and /data/ location blocks', () => {
    const count = (nginxConf.match(
      /include \/etc\/nginx\/snippets\/security-headers\.conf;/g,
    ) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
