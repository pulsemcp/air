import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/cli/vitest.config.ts",
  "packages/extensions/*/vitest.config.ts",
]);
