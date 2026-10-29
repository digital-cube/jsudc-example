import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The backend the dev proxy forwards `/udc` and `/healthz` to. `npm run e2e`
// points it at the test backend; `VITE_UDC_URL` instead makes the browser call
// a backend directly, without the proxy.
const proxyTarget = process.env.UDC_PROXY_TARGET || "http://127.0.0.1:5100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // @jsudc/core's source, so a change there needs no rebuild.
    alias: {
      // The subpath first: an alias also matches what starts with `<key>/`.
      "@jsudc/core/client": fileURLToPath(
        new URL("../packages/udc-core/src/client.ts", import.meta.url),
      ),
      "@jsudc/core": fileURLToPath(new URL("../packages/udc-core/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    proxy: {
      // The file preview is a GET; it must reach the backend before the rule below sends GETs to the app.
      "/udc/files/blob": { target: proxyTarget, changeOrigin: true },
      // `/udc/<collection>` is also an app route: only the RPC (always a POST)
      // goes to the backend, a page load gets the app.
      "/udc": {
        target: proxyTarget,
        changeOrigin: true,
        bypass: (req) => (req.method === "POST" ? undefined : "/index.html"),
      },
      "/healthz": { target: proxyTarget, changeOrigin: true },
    },
  },
});
