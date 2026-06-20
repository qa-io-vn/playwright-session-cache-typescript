import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { session } from './session.config';

// Cached feature tests — authenticated via the session cache.
const appTestDir = defineBddConfig({
  outputDir: '.features-gen/app',
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
});

// Login-flow tests — separate features + steps, NO cached session.
const loginTestDir = defineBddConfig({
  outputDir: '.features-gen/login',
  features: 'features-login/**/*.feature',
  steps: 'steps-login/**/*.ts',
});

const chrome = devices['Desktop Chrome'];

export default defineConfig({
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { baseURL: 'https://www.saucedemo.com' },

  projects: [
    // Authenticated: session.projects() prepends the setup project and injects
    // storageState + the dependency into this project.
    ...session.projects([{ name: 'chromium', testDir: appTestDir, use: { ...chrome } }]),

    // OPT-OUT: this project has NO setup dependency and an explicit EMPTY
    // storageState, guaranteeing a fresh, logged-out context for every scenario.
    {
      name: 'login',
      testDir: loginTestDir,
      use: { ...chrome, storageState: { cookies: [], origins: [] } },
    },
  ],
});
