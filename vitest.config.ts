import { defineConfig } from "vitest/config";

// `npx vitest` at the root runs every workspace that has a vitest config.
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "{backend,frontend}/vitest.config.ts"],
  },
});
