import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util"] })],
  base: process.env.VITE_BASE || "/",
  server: { port: 5173, host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
