import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    // Keep clone-retry backoff tiny in tests. The integration tests clone real
    // repos over the network; if a transient github.com hiccup triggers a retry,
    // the production defaults (5s/10s/20s) could blow a test's time budget. Unit
    // tests that exercise the retry loop pass their own explicit delays, which
    // override this. Production behavior is unaffected.
    env: {
      AIR_GIT_CLONE_RETRY_DELAYS_MS: "50,50,50",
    },
  },
});
