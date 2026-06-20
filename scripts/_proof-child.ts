// One child process: races to produce the shared cached state.
import fs from 'node:fs';
import path from 'node:path';
import { getOrCreateCached } from '../src/session-cache';

const dir = '.proof';
const statePath = path.join(dir, 'state.json');
const lockPath = path.join(dir, 'state.lock');
const counterPath = path.join(dir, 'logins.log');

(async () => {
  await getOrCreateCached({
    statePath,
    lockPath,
    ttlMs: 45 * 60_000,
    lock: { timeoutMs: 30_000, pollMs: 25 },
    produce: async () => {
      fs.appendFileSync(counterPath, `login by pid ${process.pid}\n`);
      await new Promise((r) => setTimeout(r, 400)); // widen the race window
      return JSON.stringify({ cookies: [], origins: [] });
    },
  });
})();
