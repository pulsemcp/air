import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { resolve } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");

const tryRun = (args: string, env?: Record<string, string>) => {
  const result = spawnSync(
    "npx",
    ["tsx", CLI, ...args.match(/(?:[^\s"]+|"[^"]*")+/g)!.map((s) => s.replace(/^"|"$/g, ""))],
    {
      encoding: "utf-8",
      cwd: resolve(__dirname, "../../.."),
      env: { ...process.env, ...env },
    }
  );
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
    `air-deprecated-flags-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

function makeCatalog(): string {
  return createTemp({
    "air.json": {
      name: "test",
      skills: ["./skills.json"],
      mcp: ["./mcp.json"],
      hooks: ["./hooks.json"],
      plugins: ["./plugins.json"],
      roots: ["./roots.json"],
    },
    "skills.json": {
      "skill-a": { description: "Skill A", path: "skills/skill-a" },
    },
    "skills/skill-a/SKILL.md": "# A",
    "mcp.json": {
      "mcp-a": { type: "stdio", command: "echo", args: ["hello"] },
    },
    "hooks.json": {
      "hook-a": {
        description: "Hook A",
        events: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo" }] }] },
      },
    },
    "plugins.json": {
      "plugin-a": { description: "Plugin A" },
    },
    "roots.json": {
      myroot: {
        description: "Test root",
        default_skills: ["skill-a"],
        default_mcp_servers: ["mcp-a"],
        default_hooks: ["hook-a"],
        default_plugins: ["plugin-a"],
      },
    },
  });
}

const DEPRECATED_FLAGS: Array<[string, string]> = [
  ["--skills", "--skill"],
  ["--mcp-servers", "--mcp-server"],
  ["--hooks", "--hook"],
  ["--plugins", "--plugin"],
  ["--without-skills", "--without-skill"],
  ["--without-mcp-servers", "--without-mcp-server"],
  ["--without-hooks", "--without-hook"],
  ["--without-plugins", "--without-plugin"],
];

describe("deprecated artifact flags — air prepare hard-errors", () => {
  for (const [oldFlag, newFlag] of DEPRECATED_FLAGS) {
    it(`rejects ${oldFlag} with exit 1 and an error pointing to ${newFlag}`, () => {
      const catalog = makeCatalog();
      const target = createTemp({});

      const result = tryRun(
        `prepare claude --root myroot --target ${target} ${oldFlag} something`,
        { AIR_CONFIG: resolve(catalog, "air.json") }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`${oldFlag} was renamed to ${newFlag}`);
      expect(result.stderr).toContain("v0.0.32");
      expect(result.stderr).toContain("no longer accepted");
      // .mcp.json must NOT be written when we hard-error early
      expect(existsSync(resolve(target, ".mcp.json"))).toBe(false);
    });

    it(`rejects ${oldFlag}=value (= syntax) with exit 1`, () => {
      const catalog = makeCatalog();
      const target = createTemp({});

      const result = tryRun(
        `prepare claude --root myroot --target ${target} ${oldFlag}=something`,
        { AIR_CONFIG: resolve(catalog, "air.json") }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`${oldFlag} was renamed to ${newFlag}`);
      expect(existsSync(resolve(target, ".mcp.json"))).toBe(false);
    });
  }
});

describe("deprecated artifact flags — air start hard-errors", () => {
  for (const [oldFlag, newFlag] of DEPRECATED_FLAGS) {
    it(`rejects ${oldFlag} with exit 1 and an error pointing to ${newFlag}`, () => {
      const catalog = makeCatalog();

      const result = tryRun(
        `start claude --root myroot --dry-run ${oldFlag} something`,
        { AIR_CONFIG: resolve(catalog, "air.json") }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`${oldFlag} was renamed to ${newFlag}`);
      expect(result.stderr).toContain("v0.0.32");
      expect(result.stderr).toContain("no longer accepted");
    });
  }

  it("does not reject when an agent passthrough arg after -- happens to match an old flag name", () => {
    const catalog = makeCatalog();

    const result = tryRun(
      `start claude --root myroot --dry-run -- --skills something-else`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("no longer accepted");
    expect(result.stderr).not.toContain("was renamed to");
  });

  it("does not reject a similarly-named flag that is not on the deprecated list", () => {
    const catalog = makeCatalog();

    // --skills-other-name is NOT one of the deprecated flags. The matcher must
    // do exact-base lookup on RENAMED_FLAGS, not substring/prefix matching, or
    // a future refactor that introduces regex matching could regress.
    // start uses .allowUnknownOption(true) so this falls through harmlessly.
    const result = tryRun(
      `start claude --root myroot --dry-run --skills-other-name foo`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("no longer accepted");
    expect(result.stderr).not.toContain("was renamed to");
  });
});
