import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Inside the jsudc monorepo, test against @jsudc/core's source so a change there needs no
// rebuild; standalone, the installed package is used.
const core = (file: string) => fileURLToPath(new URL(`../udc-core/src/${file}`, import.meta.url));
const inMonorepo = existsSync(core("index.ts"));

export default defineConfig({
  resolve: {
    // The subpath first: an alias also matches what starts with `<key>/`.
    alias: inMonorepo
      ? { "@jsudc/core/client": core("client.ts"), "@jsudc/core": core("index.ts") }
      : {},
  },
  test: {
    name: "udc-react",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
});
