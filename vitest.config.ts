import { defineConfig } from "vitest/config";

// `npx vitest` at the root runs both workspaces.
export default defineConfig({
  test: {
    projects: ["backend/vitest.config.ts", "frontend/vitest.config.ts"],
  },
});
