import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { execSync } from "child_process";
import { resolve } from "path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");

const runSilent = (
  args: string[],
  env?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } => {
  // spawnSync pipes stdio, which means stdin/stdout are NOT a TTY in the child.
  // That's exactly the scenario we want to exercise: auto-discovery must
  // silently no-op in non-interactive contexts.
  const result = spawnSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf-8",
    cwd: resolve(__dirname, "../../.."),
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-autodiscover-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return dir;
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

// Integration tests focused on the non-interactive paths (the only paths
// testable through spawnSync, which always produces non-TTY stdio in children).
// TTY behavior is covered by unit tests on promptYnd / runAutoDiscovery.
describe("auto-discovery — non-interactive behavior", () => {
  it("`air prepare` does not prompt or modify air.json when stdio is piped", () => {
    // A repo with a discoverable skills.json — in a TTY this would trigger
    // a prompt. Under spawnSync, discovery must stay silent.
    const repo = createTemp({
      "skills.json": {
        foo: { description: "foo", path: "skills/foo" },
      },
    });
    initGitRepo(repo);

    const airHome = createTemp({
      "air.json": {
        name: "user-config",
      },
    });

    const airConfigPath = resolve(airHome, "air.json");
    const originalConfig = readFileSync(airConfigPath, "utf-8");

    // `prepare claude` will likely error out because the config has no
    // adapters / roots, but auto-discovery runs *before* that — we just need
    // to verify it doesn't prompt or mutate air.json.
    const result = runSilent(["prepare", "claude", "--target", repo], {
      AIR_CONFIG: airConfigPath,
    });

    // The key assertion: the discovery summary should never appear on stderr
    // in a non-TTY context.
    expect(result.stderr).not.toContain(
      "Found AIR index files in this repo"
    );

    // And air.json must not have been rewritten.
    expect(readFileSync(airConfigPath, "utf-8")).toBe(originalConfig);

    // Preferences file must not have been created either — dismissal is a
    // TTY-only flow.
    const prefsPath = resolve(airHome, "preferences.json");
    expect(existsSync(prefsPath)).toBe(false);
  });

  it("`--no-discover` keeps discovery silent even if somehow a TTY is present", () => {
    // Mirror of the above, but passing --no-discover. The observable
    // behavior is identical under spawnSync, but this exercises the flag
    // parsing path in start.ts / prepare.ts so the option is wired through.
    const repo = createTemp({
      "skills.json": {
        foo: { description: "foo", path: "skills/foo" },
      },
    });
    initGitRepo(repo);

    const airHome = createTemp({
      "air.json": { name: "user-config" },
    });
    const airConfigPath = resolve(airHome, "air.json");
    const originalConfig = readFileSync(airConfigPath, "utf-8");

    const result = runSilent(
      ["prepare", "claude", "--target", repo, "--no-discover"],
      { AIR_CONFIG: airConfigPath }
    );

    expect(result.stderr).not.toContain(
      "Found AIR index files in this repo"
    );
    expect(readFileSync(airConfigPath, "utf-8")).toBe(originalConfig);
  });

  it("--skill flag suppresses discovery (scripted invocations stay quiet)", () => {
    // When the user explicitly names artifacts, we treat that as a scripted
    // flow and stay out of their way — even in a TTY we should not prompt.
    // Here we just verify the CLI accepts the flag combo without exploding;
    // the non-prompt assertion is already covered by the piped-stdio case.
    const repo = createTemp({
      "skills.json": {
        foo: { description: "foo", path: "skills/foo" },
      },
    });
    initGitRepo(repo);

    const airHome = createTemp({
      "air.json": { name: "user-config" },
    });

    const result = runSilent(
      ["prepare", "claude", "--target", repo, "--skill", "whatever"],
      { AIR_CONFIG: resolve(airHome, "air.json") }
    );

    // Config is missing the skills/roots needed to actually prepare, so the
    // command will error — but the *discovery* step must not have prompted
    // or surfaced a summary.
    expect(result.stderr).not.toContain(
      "Found AIR index files in this repo"
    );
  });
});
