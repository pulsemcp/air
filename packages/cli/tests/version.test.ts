import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import { readFileSync } from "fs";

const CLI = resolve(__dirname, "../src/index.ts");
const run = (args: string) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: "utf-8",
    cwd: resolve(__dirname, "../../.."),
    stdio: ["pipe", "pipe", "pipe"],
  });

describe("--version", () => {
  it("outputs the version from package.json", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf-8")
    );
    const output = run("--version").trim();
    expect(output).toBe(pkg.version);
  });
});
