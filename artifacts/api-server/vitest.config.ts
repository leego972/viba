import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    fileParallelism: false,
    // TEST_BYPASS_SESSION lets integration tests call protected routes
    // without a real user session — see requireSession.ts for the guard.
    env: {
      TEST_BYPASS_SESSION: "1",
      TEST_BYPASS_ADMIN: "1",
    },
  },
});
