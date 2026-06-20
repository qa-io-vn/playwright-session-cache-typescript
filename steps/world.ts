import { test as base, createBdd } from 'playwright-bdd';
import { session } from '../session.config';

// (Optional) STEP 4 — replay cached sessionStorage. Skip if your app uses none.
export const test = session.extendTest(base);

export const { Given, When, Then } = createBdd(test);
