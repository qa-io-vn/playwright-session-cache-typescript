# Stop logging in on every test: parallel-safe cached sessions in Playwright (TypeScript / playwright-bdd)

*Reading time ~12 min. Working sample in this repo — clone it and run `npm run verify`.*

If your end-to-end suite logs in through the UI before every single test, you are
paying a tax on every run: it's slow, it's flaky, and you're testing the login
form for the 300th time instead of the feature you actually care about.

This post shows a clean, reusable, **parallel-safe** way to log in **once** and
replay that session into every test — for Playwright Test and
[playwright-bdd](https://vitalets.github.io/playwright-bdd/). It comes with a
single drop-in file (`src/session-cache.ts`) and a one-call API.

> There is a sibling post for **Java/Playwright-Java** that applies the same idea
> with `ReentrantLock` instead of a file lock. Same concept, different runtime.

---

## 1. The problem

A UI login is the single most expensive and fragile thing an E2E test does:

- **Slow.** A real identity provider (Keycloak/OIDC, Cognito, Auth0…) means
  redirects, a form, often an OTP. 5–15 seconds, times every test.
- **Flaky.** The login provider is a third party with its own latency, rate
  limits, and the occasional 5xx. One hiccup fails an unrelated test.
- **Redundant.** You are re-verifying the login flow constantly when you meant to
  test the inventory page.

The fix is to treat authentication as **a fixture you build once and reuse**, not
an action you repeat.

---

## 2. The core techniques you must understand

Three Playwright concepts carry the whole solution. Understand these and the rest
is wiring.

### 2.1 `storageState()` — serialize the session

A logged-in browser session is just state attached to the browser. Playwright can
serialize and restore it:

```ts
// SAVE after a real login:
await context.storageState({ path: '.auth/user.json' });

// RESTORE into any new context:
const context = await browser.newContext({ storageState: '.auth/user.json' });
```

Every page opened in that restored context starts **already authenticated** — the
cookies ride along on the first request, so the app renders the protected page
instead of bouncing to `/login`.

### 2.2 The setup-project dependency — "log in once" for free

Playwright lets one project depend on another. A **setup project** runs first;
your test projects declare it as a `dependency` and consume its output:

```ts
projects: [
  { name: 'setup', testMatch: /auth\.setup\.ts/ },
  { name: 'chromium', dependencies: ['setup'], use: { storageState: '.auth/user.json' } },
]
```

Because Playwright workers are separate **processes**, the natural shared cache is
a **file on disk**: the setup writes it once, every worker reads it. No locking
needed for the common case — the process model gives you "once" for free.

### 2.3 Fixtures — inject behavior without touching the test

A Playwright fixture wraps every test transparently. We use an **auto fixture** to
replay `sessionStorage` (see the critical gotcha below) so the Gherkin never has
to know it exists.

---

## 3. The critical thing nobody tells you

**`storageState()` saves cookies + `localStorage` only. It does NOT save
`sessionStorage`.**

If your app keeps its token in `sessionStorage` (some SPAs and a few Keycloak
adapter setups do), a "restored" session will silently behave as logged-out and
you'll burn an afternoon wondering why.

Snapshot and replay it yourself:

```ts
// SAVE — right after login, same page:
const ss = await page.evaluate(() => JSON.stringify(sessionStorage));
fs.writeFileSync('.auth/user.session.json', ss);

// RESTORE — as an init script so it runs BEFORE the app's JS, on every page:
await context.addInitScript((entries) => {
  for (const [k, v] of Object.entries(entries)) sessionStorage.setItem(k, v as string);
}, JSON.parse(fs.readFileSync('.auth/user.session.json', 'utf8')));
```

Use `addInitScript`, **not** a post-navigation `page.evaluate` — the values must be
present before the application bootstraps and reads them.

Two more non-negotiables:

- **`.auth/` holds real tokens — git-ignore it.** Treat it like a credential.
- **Add a TTL.** Tokens expire; a stale cache makes tests fail in confusing ways.
  Refuse to reuse a session older than, say, 45 minutes.

---

## 4. Parallel-safety — the part that bites people

The setup-project pattern logs in once because the setup runs once. But the moment
you do anything fancier — **per-worker auth, multiple roles, or creating the
session lazily inside a worker** — multiple processes can race to log in at the
same time. You do not want 8 workers all hammering Keycloak.

Because Playwright parallelism is **processes** (not threads), an in-memory mutex
is useless. You need a lock visible across processes — a **file lock**:

```ts
// open(.., 'wx') is an atomic create-exclusive syscall:
// exactly ONE process creates the lock; everyone else gets EEXIST and waits.
const fd = fs.openSync(lockPath, 'wx');
```

Wrap it in **double-checked locking** — the same shape as a thread-safe singleton,
but cross-process:

1. Fast path: session fresh on disk → return it, no lock.
2. Take the file lock.
3. **Re-check** freshness (another worker may have produced it while we waited).
4. Produce exactly once, persist, return.

The kit also steals an orphaned lock (holder crashed) after a stale timeout so a
dead worker can't wedge the suite.

This repo ships a proof. `npm run prove` launches 8 processes that all hit the
cache simultaneously and asserts the producer ran **once**:

```
=== parallel-safety proof ===
processes launched : 8
real "logins" run  : 1
PASS — exactly one login across all processes
```

---

## 5. How to apply it (the whole thing in 4 one-liners)

Copy `src/session-cache.ts` into your project, then:

**Step 1 — define the cache once** (`session.config.ts`). The login lambda is the
only place your login lives:

```ts
import { defineSessionCache } from './src/session-cache';

export const session = defineSessionCache({
  key: 'saucedemo',
  login: async (page) => {
    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login-button');
    await page.waitForURL('**/inventory.html');
  },
});
```

**Step 2 — register the setup** (`auth.session-setup.ts`):

```ts
import { session } from './session.config';
session.registerSetup();
```

**Step 3 — wire the config** (`playwright.config.ts`):

```ts
projects: session.projects([{ name: 'chromium', testDir, use: { ...devices['Desktop Chrome'] } }]),
```

**Step 4 (optional) — replay sessionStorage** in your BDD fixtures
(`steps/world.ts`):

```ts
export const test = session.extendTest(base);
export const { Given, When, Then } = createBdd(test);
```

Now your feature file has **no login step at all**:

```gherkin
Feature: Inventory access via a cached session

  Scenario: Land on inventory without logging in
    Given I open the inventory page
    Then I should see the products page
```

Run it:

```bash
npm install
npx playwright install chromium
npm test
```

```
✓ [session-setup:saucedemo] cache session [saucedemo]
✓ [chromium] Land on inventory without logging in
✓ [chromium] The protected page is fully rendered
✓ [chromium] Re-entry stays authenticated
4 passed
```

The setup project performs the only real login; the scenarios open
`/inventory.html` directly and pass. Re-run within the TTL and the setup
short-circuits instead of logging in again.

---

## 6. Pros and cons

**Pros**

- **Fast.** Login cost is paid once per run (or once per TTL window) instead of
  per test. The payoff scales with how slow your login is — small for a trivial
  login, huge for Keycloak + OTP.
- **Less flaky.** The identity provider is touched once, not N times.
- **Tests stay focused.** Scenarios assert features, not the login form.
- **Drop-in & reusable.** One file, one `defineSessionCache` call, works for plain
  Playwright Test and playwright-bdd alike.
- **Parallel-safe by construction.** Atomic file lock + double-checked freshness.

**Cons / trade-offs**

- **Shared state across tests.** A cached session is reused, so a test that mutates
  account-level state can leak into others. Keep per-test data isolated; use
  distinct `key`s for distinct roles.
- **The `sessionStorage` gotcha** must be handled (this kit does, but you must know
  it exists).
- **Stale-session failures** if you skip the TTL or your token lifetime is shorter
  than it.
- **You still need one un-cached path** to actually test the login flow itself.
- **Secrets on disk.** `.auth/` must be git-ignored and treated as sensitive.

---

## 7. When to apply it (and when not)

**Apply it when:**

- Login is slow and/or flaky (real IdP, OTP, multi-step).
- You have many tests behind the same auth wall.
- You run in parallel and want to amortize login across workers.

**Don't bother / be careful when:**

- Login *is* the thing under test → keep an un-cached project for it.
- Each test legitimately needs a brand-new account/session (e.g. signup flows).
- A test mutates global/account state that other tests read → isolate data or use
  a dedicated role/key.

A healthy suite usually has **both**: a tiny set of un-cached login-flow tests, and
a large set of cached feature tests.

---

## 8. What's in this repo

```
src/session-cache.ts          # THE drop-in (copy this one file)
session.config.ts             # defineSessionCache({ login })
auth.session-setup.ts         # session.registerSetup()
playwright.config.ts          # session.projects([...])
steps/                        # world.ts (extendTest) + inventory.steps.ts
features/inventory.feature    # NO login step — that's the proof
scripts/prove-parallel.ts     # 8 processes -> exactly 1 login
```

Verify everything in one shot:

```bash
npm install && npx playwright install chromium && npm run verify
# typecheck -> parallel proof (1 login) -> live saucedemo run (no login step)
```

---

## 9. Takeaway

Authentication is a **build-once fixture**, not a per-test action. Capture the
session with `storageState()`, handle the `sessionStorage` gap, guard it with a TTL
and an atomic cross-process lock, and wire it in with one function. Your suite gets
faster and steadier, and your tests go back to testing features.
