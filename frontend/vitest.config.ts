import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "frontend",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
});
