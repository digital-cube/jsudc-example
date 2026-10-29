import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "frontend",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    server: {
      deps: {
        // @jsudc/react is installed into node_modules (a GitHub tag, no workspace
        // symlink), so Vitest would externalize it and Node would load its
        // `leaflet/dist/leaflet.css` import raw. Inline it: Vite transforms it like app code.
        inline: [/@jsudc\/react/],
      },
    },
  },
});
