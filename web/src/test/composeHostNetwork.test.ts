import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/** Extract a top-level (2-space indented) service block from compose text. */
function serviceBlock(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) throw new Error(`service ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i]!)) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

for (const file of ['docker-compose.yml', 'docker-compose.prod.yml']) {
  describe(`${file} host-network invariant`, () => {
    const text = readFileSync(path.join(repoRoot, file), 'utf-8');

    it('does not publish the api service to the host', () => {
      const api = serviceBlock(text, 'api');
      expect(api).not.toMatch(/^\s*ports:/m);
      expect(api).toMatch(/^\s*expose:/m);
      expect(api).toMatch(/"3000"/);
    });

    it('does not use host network mode anywhere', () => {
      expect(text).not.toMatch(/network_mode:\s*host/);
    });

    it('only publishes the web service, targeting container port 80', () => {
      const web = serviceBlock(text, 'web');
      expect(web).toMatch(/^\s*ports:/m);
      const mappings = [...web.matchAll(/-\s*"(\d+):(\d+)"/g)];
      expect(mappings.length).toBeGreaterThan(0);
      for (const m of mappings) expect(m[2]).toBe('80');
    });
  });
}
