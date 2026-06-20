import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { session } from './session.config';

const testDir = defineBddConfig({
  outputDir: '.features-gen',
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
});

export default defineConfig({
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { baseURL: 'https://www.saucedemo.com' },

  // STEP 3 — one call wires the setup project + storageState into every project.
  projects: session.projects([{ name: 'chromium', testDir, use: { ...devices['Desktop Chrome'] } }]),
});
