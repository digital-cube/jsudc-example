import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against @jsudc/core's source, so a change there needs no rebuild.
    alias: {
      "@jsudc/core": fileURLToPath(new URL("../packages/udc-core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    name: "backend",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Every DB test file truncates the same tables: run files one at a time.
    fileParallelism: false,
    coverage: {
      include: ["src/**/*.ts"],
      // Process entry points: thin wrappers over the tested functions they call.
      exclude: ["src/main.ts", "src/cli/**"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
