/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/target/**", "**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "chrome110", minify: "esbuild", sourcemap: false },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
