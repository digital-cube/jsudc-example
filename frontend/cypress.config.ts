import { execSync } from "node:child_process";
import { defineConfig } from "cypress";

// `npm run e2e` at the root starts the servers and passes `baseUrl`; this
// default fits `npm run dev` for `cypress open`.
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    viewportWidth: 1440,
    viewportHeight: 900,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 8000,
    retries: { runMode: 1, openMode: 0 },
    setupNodeEvents(on) {
      on("task", {
        // `npm run e2e` sets E2E_SEED_CMD; without it (cypress open on the dev DB) reseed is a no-op.
        reseed() {
          const cmd = process.env.E2E_SEED_CMD;
          if (cmd) execSync(cmd, { stdio: "inherit", timeout: 120_000 });
          return Boolean(cmd);
        },
      });
    },
  },
});
