import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// The build targets ES2022, which supports top-level await natively, so
// vite-plugin-top-level-await is not needed (its SWC pass fails on the 3D bundle).
export default defineConfig({
  plugins: [react(), wasm(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util"] })],
  base: process.env.VITE_BASE || "/",
  server: { port: 5173, host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
