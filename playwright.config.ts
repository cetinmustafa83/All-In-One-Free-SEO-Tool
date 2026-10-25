import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config.
 *
 * Runs against a real production build with its own throwaway database,
 * so a test run can never touch the developer's data.db — which also
 * means the suite is safe to run locally without thinking about it.
 *
 * The scheduler is disabled: these tests assert on UI, and a background
 * agent kicking off audits or browser work mid-run makes failures
 * nondeterministic and slow.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Sequential. The app is single-user with one SQLite file; parallel
  // specs would fight over the same rows and the same write lock.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The mobile drawer is a distinct code path from the desktop
    // sidebar, and the whole point of the nav rework was that phone
    // users get the same reach. Untested, that regresses silently.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: {
    // The backend starts in the SAME command chain: since the 14.9
    // cutover the readiness gate below — /api/v1/health — is served by
    // the Rust process through the Next rewrite, so a webServer that
    // only started Next would never become healthy on a fresh clone.
    // e2e-backend.cjs resolves a binary (release → debug → cargo build),
    // spawns it on :3201 against THIS suite's throwaway db, and exits.
    command: `node scripts/migrate.cjs && node scripts/e2e-backend.cjs && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Throwaway DB — never the developer's data.db.
      SEO_DB_PATH: ".e2e/e2e.db",
      SEO_DATA_DIR: ".e2e",
      SEO_DISABLE_SCHEDULER: "1",
      // Both halves of the cutover: the frontend's rewrite target and
      // the server-side callBackend base. The db path matches the one
      // e2e-backend.cjs was given — one file, two stacks.
      API_BACKEND_URL: "http://127.0.0.1:3201",
      SEO_BACKEND_URL: "http://127.0.0.1:3201",
    },
  },
});
