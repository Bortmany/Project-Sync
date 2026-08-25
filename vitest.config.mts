// Vitest setup: library tests run in plain Node, no browser environment needed yet.
// The setup file only points DATABASE_URL at DATABASE_URL_TEST, so the service tests never
// touch development data. The library tests do not use the database and are unaffected.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    setupFiles: ["./src/server/__tests__/setup-env.ts"],
    // The service tests share one test database, so they run one file at a time.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
