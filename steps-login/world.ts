import { test as base, createBdd } from 'playwright-bdd';

// IMPORTANT: login-flow tests use the PLAIN base test — no session.extendTest,
// no storageState. Each scenario starts in a fresh, unauthenticated context.
export const test = base;

export const { Given, When, Then } = createBdd(test);
