import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The panel is a static app under /app, served by the Worker's static assets. In development,
 * Vite proxies the API to `wrangler dev` without rewriting Host, so passkeys see one origin.
 */
const worker = "http://127.0.0.1:8787";

export default defineConfig({
  base: "/app/",
  plugins: [tailwind(), react()],
  build: { outDir: "dist/app", emptyOutDir: true, sourcemap: false },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: worker }, "/auth": { target: worker } },
  },
});
