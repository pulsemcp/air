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

const tryRun = (args: string) => {
  try {
    return { stdout: run(args), stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
};

describe("upgrade command", () => {
  it("shows current version and planned command in dry-run mode", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf-8")
    );

    const result = tryRun("upgrade --dry-run");
    expect(result.exitCode).toBe(0);

    const output = result.stdout;
    expect(output).toContain(`Current version: ${pkg.version}`);
    expect(output).toContain(
      "Would run: npm install -g @pulsemcp/air-cli@latest"
    );
  });

  it("shows help text with --help", () => {
    const result = tryRun("upgrade --help");
    expect(result.exitCode).toBe(0);

    const output = result.stdout || result.stderr;
    expect(output).toContain("Upgrade the AIR CLI to the latest version");
    expect(output).toContain("--dry-run");
  });
});
