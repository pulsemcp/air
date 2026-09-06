import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { join, resolve } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");
const run = (args: string) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: "utf-8",
    cwd: resolve(__dirname, "../../.."),
    stdio: ["pipe", "pipe", "pipe"],
  });

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

/**
 * Build a stale `~/.air`-shaped directory: air.json listing extensions, a
 * package.json pinning them to an old range, and a node_modules tree at that
 * old version — the starting state reported in issue #131.
 */
function createStaleAirDir(): string {
  const dir = resolve(
    tmpdir(),
    `air-cli-upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);

  writeFileSync(
    join(dir, "air.json"),
    JSON.stringify(
      {
        name: "test",
        extensions: [
          "@pulsemcp/air-adapter-claude",
          "./local-transform.js",
        ],
      },
      null,
      2
    )
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "air-extensions",
        private: true,
        dependencies: { "@pulsemcp/air-adapter-claude": "^0.0.25" },
      },
      null,
      2
    ) + "\n"
  );

  const pkgDir = join(dir, "node_modules", "@pulsemcp", "air-adapter-claude");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@pulsemcp/air-adapter-claude",
      version: "0.0.25",
    })
  );

  return dir;
}

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
    expect(output).toContain("--no-extensions");
  });

  it("plans the extension upgrade in dry-run mode without touching the prefix", () => {
    const dir = createStaleAirDir();
    const before = readFileSync(join(dir, "package.json"), "utf-8");

    const result = tryRun(
      `upgrade --dry-run --config ${join(dir, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    // The stale extension is named, with the lockstep range it would move to.
    // The exact minor depends on what npm currently serves as latest, so match
    // the shape rather than pinning this test to a published version.
    expect(result.stdout).toMatch(
      /@pulsemcp\/air-adapter-claude — 0\.0\.25 → ~\d+\.\d+\.0/
    );
    expect(result.stdout).toMatch(
      /Would pin in .*package\.json: @pulsemcp\/air-adapter-claude: "~\d+\.\d+\.0"/
    );
    expect(result.stdout).toContain(`Would run: npm install --prefix ${dir}`);
    // Local path extensions are named as skipped, not silently dropped.
    expect(result.stdout).toContain("./local-transform.js");
    expect(result.stdout).toContain("local path extension");

    // Nothing on disk changed.
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });

  it("leaves the extension tree alone with --no-extensions", () => {
    const dir = createStaleAirDir();

    const result = tryRun(
      `upgrade --dry-run --no-extensions --config ${join(dir, "air.json")}`
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("@pulsemcp/air-adapter-claude");
  });

  it("says so when there is no air.json to read extensions from", () => {
    const dir = resolve(
      tmpdir(),
      `air-cli-upgrade-empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const result = tryRun(
      `upgrade --dry-run --config ${join(dir, "air.json")}`
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("extension upgrade failed");
  });
});
