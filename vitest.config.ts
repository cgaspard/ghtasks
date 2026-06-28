import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Unit tests for pure frontend logic (no Tauri, no browser app shell).
// E2E tests live under tests/e2e and run via Playwright, not vitest.
export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
    globals: true,
  },
});
