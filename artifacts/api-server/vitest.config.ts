import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    fileParallelism: false,
    // Test-only placeholders satisfy import-time validation. Tests mock database
    // and provider I/O; these values must never be used outside Vitest.
    env: {
      TEST_BYPASS_SESSION: "1",
      TEST_BYPASS_ADMIN: "1",
      DATABASE_URL: "postgresql://viba_test:viba_test@127.0.0.1:5432/viba_test",
      GROQ_API_KEY: "test-groq-key-not-for-live-use",
    },
  },
});
