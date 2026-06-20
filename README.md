# playwright-session-cache-typescript

Parallel-safe **cached-session login** for Playwright / playwright-bdd — a full
blog post plus a working sample.

- 📖 **[BLOG.md](BLOG.md)** — the complete write-up: how to apply, pros/cons, when
  to use, the critical `sessionStorage` gotcha, and the parallel-safety technique.
- 🧩 **[src/session-cache.ts](src/session-cache.ts)** — the drop-in. Copy this one
  file, call `defineSessionCache({ login })`.

Target app: [saucedemo.com](https://www.saucedemo.com) (`standard_user` / `secret_sauce`).

## Quick start

```bash
npm install
npx playwright install chromium
npm run verify     # typecheck + parallel proof + live saucedemo example
```

| Command | What it proves |
|---|---|
| `npm run typecheck` | the drop-in compiles under strict TS |
| `npm run prove` | `PROOF_PROCS=8` processes → **exactly 1 login** (parallel-safe) |
| `npm test` | live playwright-bdd run on saucedemo, **no login step** |

## Apply it in your project (4 one-liners)

1. `session.config.ts` — `defineSessionCache({ login })`
2. `auth.session-setup.ts` — `session.registerSetup()`
3. `playwright.config.ts` — `projects: session.projects([...])`
4. `steps/world.ts` — `export const test = session.extendTest(base)` *(optional; only if your app uses sessionStorage)*

## Testing the login flow (opting out)

Login-flow tests must run logged-out, so they skip the cache. This repo puts them
in a separate `login` **project** with no setup dependency and an explicit empty
`storageState` (see [playwright.config.ts](playwright.config.ts),
[features-login/](features-login/), [steps-login/](steps-login/)):

```ts
{ name: 'login', testDir: loginTestDir, use: { ...chrome, storageState: { cookies: [], origins: [] } } }
```

`npm test` runs the cached `chromium` project **and** the logged-out `login`
project (1 happy + 3 unhappy login scenarios) together. Full explanation in
[BLOG.md §8](BLOG.md).

> ⚠️ `.auth/` holds real session cookies and is git-ignored. Never commit it.

## Sibling

Same technique for Java/Playwright-Java (with `ReentrantLock` + Cucumber-JVM):
`playwright-session-cache-java`.
