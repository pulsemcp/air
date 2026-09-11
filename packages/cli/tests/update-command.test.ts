import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { join, resolve } from "path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");
const REPO_ROOT = resolve(__dirname, "../../..");
const TSX = createRequire(__filename).resolve("tsx/cli");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function tempDir(label: string): string {
  const dir = resolve(
    tmpdir(),
    `air-cli-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/**
 * A stand-in `npm` placed first on PATH.
 *
 * Every npm invocation is appended to a log file, `npm view` answers with a
 * fixed version, and nothing is ever installed. This is what lets the suite
 * assert on the thing that actually matters — *whether* `npm install -g` was
 * reached — without a test run mutating the machine's global npm tree.
 */
function createFakeNpm(latestVersion: string): { bin: string; log: string } {
  const bin = tempDir("fake-npm");
  const log = join(bin, "npm-invocations.log");
  writeFileSync(
    join(bin, "npm"),
    [
      "#!/bin/sh",
      `echo "$@" >> "${log}"`,
      'if [ "$1" = "view" ]; then',
      `  echo "${latestVersion}"`,
      "fi",
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(join(bin, "npm"), 0o755);
  writeFileSync(log, "");
  return { bin, log };
}

/**
 * A stale `~/.air`-shaped directory: air.json listing an extension, a
 * package.json pinning it to an old range, and a loadable node_modules tree at
 * that old version — the starting state reported in issues #131 and #132.
 */
function createStaleAirDir(): string {
  const dir = tempDir("update");

  writeFileSync(
    join(dir, "air.json"),
    JSON.stringify(
      {
        name: "test",
        extensions: ["@pulsemcp/air-adapter-claude", "./local-transform.js"],
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
  writeFileSync(join(dir, "local-transform.js"), "export default () => {};\n");

  const pkgDir = join(dir, "node_modules", "@pulsemcp", "air-adapter-claude");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@pulsemcp/air-adapter-claude",
      version: "0.0.25",
      type: "module",
      main: "index.js",
    })
  );
  writeFileSync(
    join(pkgDir, "index.js"),
    'export default { name: "@pulsemcp/air-adapter-claude" };\n'
  );

  return dir;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI in a child process — which is inherently **not** a TTY, so every
 * run here exercises the non-interactive path by construction.
 */
function run(args: string[], env: NodeJS.ProcessEnv = {}): RunResult {
  const child = spawnSync(process.execPath, [TSX, CLI, ...args], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  return {
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    exitCode: child.status ?? 1,
  };
}

/** Run against a fake npm and an isolated HOME. */
function runIsolated(
  args: string[],
  fake: { bin: string; log: string },
  home: string
): RunResult {
  return run(args, {
    PATH: `${fake.bin}:${process.env.PATH}`,
    HOME: home,
    AIR_CONFIG: "",
  });
}

const npmLog = (fake: { log: string }) => readFileSync(fake.log, "utf-8");

describe("air update — the non-TTY default", () => {
  it("never runs npm install -g without --yes when stdout is not a terminal", () => {
    // The single sharpest risk in this change: an unattended global install in
    // CI is the exact thing issue #132 exists to prevent.
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["update", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Not an interactive terminal");
    expect(result.stdout).toContain("Re-run with --yes");

    // npm was consulted for versions, and never asked to install anything.
    const log = npmLog(fake);
    expect(log).toContain("view @pulsemcp/air-cli version");
    expect(log).not.toContain("install -g");
    expect(log).not.toContain("install --prefix");

    // The manifest is byte-identical — nothing was pinned either.
    expect(
      JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).dependencies
    ).toEqual({ "@pulsemcp/air-adapter-claude": "^0.0.25" });
  });

  it("still reports what it found, so the skip is diagnosable", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["update", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.stdout).toContain("Version check:");
    expect(result.stdout).toMatch(/@pulsemcp\/air-cli\s+\S+ → 0\.99\.0/);
    expect(result.stdout).toMatch(
      /@pulsemcp\/air-adapter-claude\s+0\.0\.25 → ~0\.99\.0/
    );
  });
});

describe("air update — flags", () => {
  it("--yes upgrades the CLI and the extensions without prompting", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["update", "--yes", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    const log = npmLog(fake);
    expect(log).toContain("install -g @pulsemcp/air-cli@latest");
    expect(log).toContain(`install --prefix ${dir}`);
    expect(result.stdout).toContain("Upgraded @pulsemcp/air-cli");
    expect(result.stdout).toContain(
      "Upgraded 1 extension(s): @pulsemcp/air-adapter-claude"
    );

    // The lockstep range was written to the manifest.
    expect(
      JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).dependencies
    ).toEqual({ "@pulsemcp/air-adapter-claude": "~0.99.0" });
  });

  it("--no-upgrade reports the bumps and installs nothing", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["update", "--no-upgrade", "--yes", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Version check:");
    expect(result.stdout).toContain("--no-upgrade: nothing was installed");

    // --no-upgrade outranks --yes.
    const log = npmLog(fake);
    expect(log).not.toContain("install -g");
    expect(log).not.toContain("install --prefix");
  });

  it("--dry-run names the commands it would have run", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");
    const before = readFileSync(join(dir, "package.json"), "utf-8");

    const result = runIsolated(
      ["update", "--dry-run", "--yes", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Would run: npm install -g @pulsemcp/air-cli@latest"
    );
    expect(result.stdout).toMatch(
      /Would pin in .*package\.json: @pulsemcp\/air-adapter-claude: "~0\.99\.0"/
    );
    expect(result.stdout).toContain(`Would run: npm install --prefix ${dir}`);

    expect(npmLog(fake)).not.toContain("install");
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });

  it("--no-extensions leaves the extension tree out of the check", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      [
        "update",
        "--no-extensions",
        "--yes",
        "--config",
        join(dir, "air.json"),
      ],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("@pulsemcp/air-adapter-claude");
    expect(npmLog(fake)).toContain("install -g @pulsemcp/air-cli@latest");
    expect(npmLog(fake)).not.toContain("install --prefix");
  });

  it("names the extensions it deliberately did not touch", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["update", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.stdout).toContain("Extensions not upgraded:");
    expect(result.stdout).toContain("./local-transform.js");
    expect(result.stdout).toContain("local path extension");
  });

  it("says everything is up to date when nothing needs a bump", () => {
    const dir = tempDir("current");
    writeFileSync(
      join(dir, "air.json"),
      JSON.stringify({ name: "test", extensions: [] }, null, 2)
    );
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf-8")
    );
    const fake = createFakeNpm(pkg.version);

    const result = runIsolated(
      ["update", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Everything is up to date.");
    expect(npmLog(fake)).not.toContain("install");
  });
});

describe("air upgrade — the deprecated alias", () => {
  it("warns, then does the same job as air update", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["upgrade", "--yes", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "`air upgrade` is deprecated — use `air update` instead."
    );

    // Deprecating is not removing: it still refreshes caches and upgrades.
    expect(result.stdout).toContain("Refreshing provider caches…");
    expect(npmLog(fake)).toContain("install -g @pulsemcp/air-cli@latest");
    expect(npmLog(fake)).toContain(`install --prefix ${dir}`);
  });

  it("honours the non-TTY default too", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      ["upgrade", "--config", join(dir, "air.json")],
      fake,
      dir
    );

    expect(result.stdout).toContain("Not an interactive terminal");
    expect(npmLog(fake)).not.toContain("install -g");
  });

  it("accepts the flags the old command took", () => {
    const dir = createStaleAirDir();
    const fake = createFakeNpm("0.99.0");

    const result = runIsolated(
      [
        "upgrade",
        "--dry-run",
        "--no-extensions",
        "--config",
        join(dir, "air.json"),
      ],
      fake,
      dir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Would run: npm install -g @pulsemcp/air-cli@latest"
    );
  });
});

describe("air update — help", () => {
  it("documents the merged command and its flags", () => {
    const result = run(["update", "--help"]);
    const output = result.stdout || result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Refresh cached provider data");
    expect(output).toContain("--yes");
    expect(output).toContain("--no-upgrade");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--no-extensions");
    expect(output).toContain("--no-auto-heal");
    expect(output).toContain("--git-protocol");
  });

  it("marks air upgrade as deprecated in its help", () => {
    const result = run(["upgrade", "--help"]);
    const output = result.stdout || result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Deprecated alias for `air update`");
  });

  it("lists both commands at the top level", () => {
    const result = run(["--help"]);
    const output = result.stdout || result.stderr;

    expect(output).toContain("update");
    expect(output).toContain("upgrade");
  });
});
