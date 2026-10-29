import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Subpaths first: an alias also matches what starts with `<key>/`.
      "@jsudc/core/client": fileURLToPath(
        new URL("../packages/udc-core/src/client.ts", import.meta.url),
      ),
      "@jsudc/core": fileURLToPath(new URL("../packages/udc-core/src/index.ts", import.meta.url)),
      "@jsudc/react/styles.css": fileURLToPath(
        new URL("../packages/udc-react/src/styles.css", import.meta.url),
      ),
      "@jsudc/react/tokens.css": fileURLToPath(
        new URL("../packages/udc-react/src/tokens.css", import.meta.url),
      ),
      "@jsudc/react": fileURLToPath(new URL("../packages/udc-react/src/index.ts", import.meta.url)),
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
