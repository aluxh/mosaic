import { requireTokenSecret } from '../lib/auth.js';
import { mintToken } from '../lib/token.js';
import { resolveEventMode } from '../lib/seedEvents.js';

function main(): void {
  const secret = requireTokenSecret(process.env);
  const ttlDays = Number(process.env.TOKEN_TTL_DAYS) || 14;
  const eid = resolveEventMode();
  const args = process.argv.slice(2);
  const isAdmin = args.includes('--admin');
  const baseUrl = args.find((a) => !a.startsWith('--')); // optional

  const result = mintToken({ secret, eid, ttlDays, baseUrl, ...(isAdmin ? { role: 'admin' as const } : {}) });
  console.log(result.token);
  console.log(`Expires: ${result.expiresAt}`);
  console.log(result.url);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
