/**
 * session-cache.ts — copy this ONE file into your project.
 * =====================================================================
 * Portable, parallel-safe cached-session login for Playwright / playwright-bdd.
 * Call `defineSessionCache({ login })` once; wire it in three one-liners.
 *
 * Parallel model: Playwright Test runs worker PROCESSES, so the "log in once"
 * guard is an atomic FILE lock + double-checked freshness (not an in-memory mutex).
 * =====================================================================
 */
import { test as setupTest, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page, PlaywrightTestConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export type PlaywrightProject = NonNullable<PlaywrightTestConfig['projects']>[number];

export interface SessionCacheOptions {
  /** Your login steps. Runs at most once per TTL window, process-safe. */
  login: (page: Page, context: BrowserContext) => Promise<void>;
  /** Cache namespace (one per role). Default 'default'. */
  key?: string;
  /** Minutes before a cached session is stale. Default 45. */
  ttlMinutes?: number;
  /** Where cache files live. Default '.auth'. */
  authDir?: string;
  /** Generated setup-project name. Default `session-setup:<key>`. */
  setupProjectName?: string;
  /** Where the *.session-setup.ts file lives (relative to config). Default '.'. */
  setupDir?: string;
  /** File that registers the setup. Default /\.session-setup\.ts$/. */
  setupMatch?: RegExp;
  /** Also snapshot/replay sessionStorage (storageState omits it). Default true. */
  sessionStorage?: boolean;
  /** Cross-process lock tuning. */
  lockTimeoutMs?: number;
  lockStaleMs?: number;
  lockPollMs?: number;
}

export interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A cached file is fresh while younger than the TTL. */
export function isFresh(file: string, ttlMs: number): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < ttlMs;
  } catch {
    return false;
  }
}

/**
 * Cross-process lock. `open(.., 'wx')` is an atomic create-exclusive syscall:
 * exactly one process wins; the rest get EEXIST and wait. Orphaned locks (holder
 * crashed) are stolen after `staleMs`.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const staleMs = opts.staleMs ?? 60_000;
  const pollMs = opts.pollMs ?? 100;
  const start = Date.now();

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, `${process.pid}:${Date.now()}`);
      } finally {
        fs.closeSync(fd);
      }
      try {
        return await fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* gone */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`withFileLock: timed out after ${timeoutMs}ms waiting for ${lockPath}`);
      }
      await sleep(pollMs);
    }
  }
}

/**
 * Process-safe get-or-create with DOUBLE-CHECKED locking:
 *   fast path (fresh on disk) -> lock -> re-check -> produce once -> persist.
 */
export async function getOrCreateCached(args: {
  statePath: string;
  lockPath: string;
  ttlMs: number;
  produce: () => Promise<string>;
  lock?: LockOptions;
}): Promise<string> {
  const { statePath, lockPath, ttlMs, produce, lock } = args;
  if (isFresh(statePath, ttlMs)) return fs.readFileSync(statePath, 'utf8');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  return withFileLock(
    lockPath,
    async () => {
      if (isFresh(statePath, ttlMs)) return fs.readFileSync(statePath, 'utf8');
      const json = await produce();
      fs.writeFileSync(statePath, json);
      return json;
    },
    lock,
  );
}

/** THE one function. Define once, reference in your setup file, config and fixtures. */
export function defineSessionCache(options: SessionCacheOptions) {
  const key = options.key ?? 'default';
  const ttlMs = (options.ttlMinutes ?? 45) * 60_000;
  const authDir = options.authDir ?? '.auth';
  const setupProjectName = options.setupProjectName ?? `session-setup:${key}`;
  const setupDir = options.setupDir ?? '.';
  const setupMatch = options.setupMatch ?? /\.session-setup\.ts$/;
  const captureSession = options.sessionStorage ?? true;

  const storageStatePath = path.join(authDir, `${key}.json`);
  const sessionStoragePath = path.join(authDir, `${key}.session.json`);
  const lockPath = path.join(authDir, `${key}.lock`);
  const lock = {
    timeoutMs: options.lockTimeoutMs,
    staleMs: options.lockStaleMs,
    pollMs: options.lockPollMs,
  };

  async function getOrCreateSession(browser: Browser): Promise<string> {
    return getOrCreateCached({
      statePath: storageStatePath,
      lockPath,
      ttlMs,
      lock,
      produce: async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await options.login(page, context);
          const state = await context.storageState();
          if (captureSession) {
            const ss = await page.evaluate(() => JSON.stringify(window.sessionStorage));
            fs.writeFileSync(sessionStoragePath, ss);
          }
          return JSON.stringify(state);
        } finally {
          await context.close();
        }
      },
    });
  }

  return {
    storageStatePath,
    sessionStoragePath,

    /** Call inside your *.session-setup.ts file. */
    registerSetup() {
      setupTest(`cache session [${key}]`, async ({ browser }) => {
        await getOrCreateSession(browser);
      });
    },

    /** Wrap your projects: prepends the setup project + injects storageState + dependency. */
    projects(testProjects: PlaywrightProject[]): PlaywrightProject[] {
      const setupProject = {
        name: setupProjectName,
        testDir: setupDir,
        testMatch: setupMatch,
      } as PlaywrightProject;
      const wired = testProjects.map((p) => ({
        ...p,
        dependencies: [...(p.dependencies ?? []), setupProjectName],
        use: { ...(p.use ?? {}), storageState: storageStatePath },
      }));
      return [setupProject, ...wired];
    },

    /** Extend a base test with the sessionStorage-restore auto-fixture. */
    extendTest<T>(base: T): T {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (base as any).extend({
        _restoreSessionStorage: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async ({ context }: any, use: any) => {
            if (captureSession && fs.existsSync(sessionStoragePath)) {
              const data = JSON.parse(fs.readFileSync(sessionStoragePath, 'utf8')) as Record<
                string,
                string
              >;
              if (Object.keys(data).length > 0) {
                await context.addInitScript((entries: Record<string, string>) => {
                  for (const [k, v] of Object.entries(entries)) {
                    window.sessionStorage.setItem(k, v);
                  }
                }, data);
              }
            }
            await use();
          },
          { auto: true },
        ],
      }) as T;
    },

    getOrCreateSession,

    /** Alternative wiring: Playwright globalSetup (launches its own browser). */
    async runGlobalSetup(): Promise<void> {
      const browser = await chromium.launch();
      try {
        await getOrCreateSession(browser);
      } finally {
        await browser.close();
      }
    },
  };
}
