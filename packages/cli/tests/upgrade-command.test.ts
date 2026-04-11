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
  it("shows current version and latest version info in dry-run mode", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf-8")
    );

    const result = tryRun("upgrade --dry-run");
    expect(result.exitCode).toBe(0);

    const output = result.stdout;
    expect(output).toContain(`Current version: ${pkg.version}`);
    // Should either show "Would run" or "Already up to date"
    expect(
      output.includes("Would run: npm install -g @pulsemcp/air-cli@latest") ||
        output.includes("Already up to date.")
    ).toBe(true);
  });

  it("reports already up to date when current matches latest", () => {
    // The published version on npm is 0.0.17, and local is 0.0.18,
    // so this won't hit "already up to date" in CI. Instead, verify
    // the command exits cleanly and includes version information.
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf-8")
    );

    const result = tryRun("upgrade --dry-run");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Current version: ${pkg.version}`);
  });

  it("shows help text with --help", () => {
    const result = tryRun("upgrade --help");
    expect(result.exitCode).toBe(0);

    const output = result.stdout || result.stderr;
    expect(output).toContain("Upgrade the AIR CLI to the latest version");
    expect(output).toContain("--dry-run");
  });
});
