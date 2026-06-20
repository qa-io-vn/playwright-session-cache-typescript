// Spawns N processes that hit the cache at once and asserts the producer
// ("login") ran EXACTLY once — the cross-process equivalent of "thread safe".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.env.PROOF_PROCS ?? 8);
const dir = '.proof';

(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const codes = await Promise.all(
    Array.from(
      { length: N },
      (_, i) =>
        new Promise<number>((resolve) => {
          const p = spawn('npx', ['tsx', 'scripts/_proof-child.ts', String(i)], {
            stdio: 'inherit',
            env: process.env,
          });
          p.on('exit', (code) => resolve(code ?? 1));
        }),
    ),
  );

  const counterPath = path.join(dir, 'logins.log');
  const logins = fs.existsSync(counterPath)
    ? fs.readFileSync(counterPath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;

  console.log('\n=== parallel-safety proof ===');
  console.log(`processes launched : ${N}`);
  console.log(`real "logins" run  : ${logins}`);
  console.log(`all exited 0       : ${codes.every((c) => c === 0)}`);
  const pass = logins === 1 && codes.every((c) => c === 0);
  console.log(pass ? 'PASS — exactly one login across all processes' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
