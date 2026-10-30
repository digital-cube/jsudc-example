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
        // @jsudc/react is a real npm package dir in node_modules, which Vitest would externalize (Node can't load its leaflet.css import); inline it so Vite transforms it.
        inline: [/@jsudc\/react/],
      },
    },
  },
});
