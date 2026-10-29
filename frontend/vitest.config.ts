import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The subpath first: an alias also matches what starts with `<key>/`.
      "@jsudc/core/client": fileURLToPath(
        new URL("../packages/udc-core/src/client.ts", import.meta.url),
      ),
      "@jsudc/core": fileURLToPath(new URL("../packages/udc-core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    name: "frontend",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
});
