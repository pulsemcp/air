import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/sdk/vitest.config.ts",
  "packages/cli/vitest.config.ts",
  "packages/extensions/*/vitest.config.ts",
  "tests/e2e/vitest.config.ts",
]);
