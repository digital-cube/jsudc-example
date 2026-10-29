import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Every dependency and peer stays an import in the output, subpaths too
// (`react/jsx-runtime`, `leaflet/dist/leaflet.css`): the host's bundler
// resolves them once, so there is one React and one QueryClient context.
const external = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];
const isExternal = (id: string) => external.some((d) => id === d || id.startsWith(`${d}/`));

// Library mode, ESM only, one output file per source module so a host's
// bundler can drop what it does not import. Types come from `tsc`
// (tsconfig.build.json), the stylesheet from the Tailwind CLI (`build:css`).
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: "src/index.ts", formats: ["es"] },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      external: isExternal,
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
      },
    },
  },
});
