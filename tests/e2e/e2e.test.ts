import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  chmodSync,
} from "fs";
import { tmpdir } from "os";

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/cli/src/index.ts");
const FIXTURES = resolve(__dirname, "fixtures");

const run = (args: string, env?: Record<string, string>) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: "utf-8",
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

const tryRun = (args: string, env?: Record<string, string>) => {
  try {
    return { stdout: run(args, env), stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
};

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `air-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

const tryRunInDir = (args: string, cwd: string, env?: Record<string, string>) => {
  try {
    return {
      stdout: execSync(`npx tsx ${CLI} ${args}`, {
        encoding: "utf-8",
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      }),
      stderr: "",
      exitCode: 0,
    };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
};

function createStubClaude(dir: string, argsFile?: string): string {
  const script = argsFile
    ? `#!/bin/sh\nfor arg in "$@"; do echo "$arg"; done > "${argsFile}"\nexit 0\n`
    : "#!/bin/sh\nexit 0\n";
  writeFileSync(join(dir, "claude"), script);
  chmodSync(join(dir, "claude"), 0o755);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// 1. air validate
// ---------------------------------------------------------------------------

describe("air validate", () => {
  it("validates all example files", () => {
    const examples = [
      "examples/air.json",
      "examples/skills/skills.json",
      "examples/mcp/mcp.json",
      "examples/roots/roots.json",
      "examples/references/references.json",
      "examples/plugins/plugins.json",
      "examples/hooks/hooks.json",
    ];

    for (const file of examples) {
      const result = tryRun(`validate ${file}`);
      expect(result.exitCode, `${file} should be valid`).toBe(0);
    }
  });

  it("validates all e2e fixture files", () => {
    const fixtures = [
      "air.json",
      "skills/skills.json",
      "mcp/mcp.json",
      "roots/roots.json",
      "references/references.json",
      "plugins/plugins.json",
      "hooks/hooks.json",
    ];

    for (const file of fixtures) {
      const result = tryRun(`validate ${resolve(FIXTURES, file)}`);
      expect(result.exitCode, `fixture ${file} should be valid`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. air init
// ---------------------------------------------------------------------------

describe("air init", () => {
  it("discovers artifacts from the AIR repo and generates github:// URIs", () => {
    const dir = createTempDir();
    const airJsonPath = join(dir, "air.json");

    const result = tryRun(`init --path ${airJsonPath} --force`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pulsemcp/air");
    expect(result.stdout).toContain("Discovered");

    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.extensions).toContain("@pulsemcp/air-provider-github");

    // At least one artifact array should contain github:// URIs
    const allArrays = [
      ...(airJson.skills || []),
      ...(airJson.references || []),
      ...(airJson.mcp || []),
      ...(airJson.roots || []),
      ...(airJson.plugins || []),
      ...(airJson.hooks || []),
    ];
    const hasGithubUri = allArrays.some((uri: string) =>
      uri.startsWith("github://")
    );
    expect(hasGithubUri).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. air list
// ---------------------------------------------------------------------------

describe("air list", () => {
  const fixtureEnv = { AIR_CONFIG: join(FIXTURES, "air.json") };

  it("lists skills", () => {
    const result = tryRun("list skills", fixtureEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("deploy");
    expect(result.stdout).toContain("incident-response");
    expect(result.stdout).toContain("query-builder");
    expect(result.stdout).toContain("provision-env");
    expect(result.stdout).toContain("component-review");
    expect(result.stdout).toContain("lint-fix");
    expect(result.stdout).toContain("format-check");
  });

  it("lists mcp servers", () => {
    const result = tryRun("list mcp", fixtureEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("github-server");
    expect(result.stdout).toContain("postgres-db");
    expect(result.stdout).toContain("analytics-api");
    expect(result.stdout).toContain("terraform-server");
    expect(result.stdout).toContain("design-system");
  });

  it("lists roots", () => {
    const result = tryRun("list roots", fixtureEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("platform-orchestrator");
    expect(result.stdout).toContain("data-pipeline");
    expect(result.stdout).toContain("infra-agent");
    expect(result.stdout).toContain("frontend-app");
  });

  it("lists plugins", () => {
    const result = tryRun("list plugins", fixtureEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("platform-quality");
  });

  it("lists hooks", () => {
    const result = tryRun("list hooks", fixtureEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("session-audit");
    expect(result.stdout).toContain("lint-check");
  });

  it("lists references", () => {
    const result = tryRun("list references", fixtureEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("git-workflow");
    expect(result.stdout).toContain("deploy-checklist");
    expect(result.stdout).toContain("runbook");
    expect(result.stdout).toContain("design-guide");
  });
});

// ---------------------------------------------------------------------------
// 4. air install
// ---------------------------------------------------------------------------

describe("air install", () => {
  it("reports workspace extensions as already installed", () => {
    // Use --prefix pointing to the monorepo root where workspace packages
    // are symlinked in node_modules/
    const result = tryRun(
      `install --config ${join(FIXTURES, "air.json")} --prefix ${ROOT}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.alreadyInstalled).toContain("@pulsemcp/air-adapter-claude");
    expect(output.alreadyInstalled).toContain("@pulsemcp/air-provider-github");
    expect(output.alreadyInstalled).toContain("@pulsemcp/air-secrets-env");
    expect(output.alreadyInstalled).toContain("@pulsemcp/air-secrets-file");
    expect(output.installed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. air prepare — orchestrator root (subagent merging)
// ---------------------------------------------------------------------------

describe("air prepare", () => {
  it("prepares orchestrator root with subagent merging and secrets resolution", () => {
    const target = createTempDir();

    const result = tryRun(
      `prepare claude` +
        ` --config ${join(FIXTURES, "air.json")}` +
        ` --root platform-orchestrator` +
        ` --target ${target}` +
        ` --secrets-file ${join(FIXTURES, "secrets.json")}`,
      { GITHUB_TOKEN: "ghp_test_e2e_token" }
    );
    expect(result.exitCode).toBe(0);

    // -- .mcp.json written with merged servers (parent + both subagents) --
    const mcpJsonPath = join(target, ".mcp.json");
    expect(existsSync(mcpJsonPath)).toBe(true);
    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));

    // Parent's servers
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["postgres-db"]).toBeDefined();
    // Subagent servers merged in
    expect(mcpJson.mcpServers["analytics-api"]).toBeDefined();
    expect(mcpJson.mcpServers["terraform-server"]).toBeDefined();
    // Not referenced by any active root
    expect(mcpJson.mcpServers["design-system"]).toBeUndefined();

    // -- Secrets resolved by secrets-env --
    expect(mcpJson.mcpServers["github-server"].env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "ghp_test_e2e_token"
    );

    // -- Secrets resolved by secrets-file --
    expect(mcpJson.mcpServers["postgres-db"].env.DATABASE_URI).toBe(
      "postgresql://admin:s3cret@db.acme.internal:5432/platform"
    );
    expect(mcpJson.mcpServers["analytics-api"].headers.Authorization).toBe(
      "Bearer ak_live_acme_analytics_token"
    );

    // -- Skills injected (parent + subagents) --
    expect(existsSync(join(target, ".claude", "skills", "deploy", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "incident-response", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "query-builder", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "provision-env", "SKILL.md"))).toBe(true);
    // Plugin-expanded skills
    expect(existsSync(join(target, ".claude", "skills", "lint-fix", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "format-check", "SKILL.md"))).toBe(true);

    // -- Skill references copied --
    const deployRef = join(target, ".claude", "skills", "deploy", "references", "GIT_WORKFLOW.md");
    expect(existsSync(deployRef)).toBe(true);
    expect(readFileSync(deployRef, "utf-8")).toContain("Branch Naming");

    const deployChecklist = join(target, ".claude", "skills", "deploy", "references", "DEPLOY_CHECKLIST.md");
    expect(existsSync(deployChecklist)).toBe(true);

    // -- Hooks injected --
    expect(existsSync(join(target, ".claude", "hooks", "session-audit", "HOOK.json"))).toBe(true);
    // Plugin-expanded hook
    expect(existsSync(join(target, ".claude", "hooks", "lint-check", "HOOK.json"))).toBe(true);

    // -- JSON output structure --
    const output = JSON.parse(result.stdout);
    expect(output.configFiles).toContain(mcpJsonPath);
    expect(output.skillPaths.length).toBeGreaterThanOrEqual(6);
    expect(output.hookPaths.length).toBeGreaterThanOrEqual(2);
    expect(output.startCommand).toBeDefined();

    // -- Subagent context generated --
    expect(output.subagentContext).toBeDefined();
    expect(output.subagentContext).toContain("Data Pipeline Agent");
    expect(output.subagentContext).toContain("Infrastructure Agent");
    expect(output.subagentContext).toContain("subagents/data");
    expect(output.subagentContext).toContain("subagents/infra");
  });

  it("prepares frontend root without subagents", () => {
    const target = createTempDir();

    const result = tryRun(
      `prepare claude` +
        ` --config ${join(FIXTURES, "air.json")}` +
        ` --root frontend-app` +
        ` --target ${target}` +
        ` --skip-validation`,
      { GITHUB_TOKEN: "ghp_test_e2e_token" }
    );
    expect(result.exitCode).toBe(0);

    const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));

    // Only frontend root's servers
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["design-system"]).toBeDefined();
    expect(mcpJson.mcpServers["postgres-db"]).toBeUndefined();
    expect(mcpJson.mcpServers["analytics-api"]).toBeUndefined();
    expect(mcpJson.mcpServers["terraform-server"]).toBeUndefined();

    // Frontend's skills + plugin-expanded skills
    expect(existsSync(join(target, ".claude", "skills", "component-review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "lint-fix", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "format-check", "SKILL.md"))).toBe(true);
    // Not frontend's skills
    expect(existsSync(join(target, ".claude", "skills", "deploy"))).toBe(false);

    // Frontend hooks
    expect(existsSync(join(target, ".claude", "hooks", "lint-check", "HOOK.json"))).toBe(true);
    expect(existsSync(join(target, ".claude", "hooks", "session-audit"))).toBe(false);

    // No subagent context
    const output = JSON.parse(result.stdout);
    expect(output.subagentContext).toBeUndefined();
  });

  it("skips subagent merge with --no-subagent-merge", () => {
    const target = createTempDir();

    const result = tryRun(
      `prepare claude` +
        ` --config ${join(FIXTURES, "air.json")}` +
        ` --root platform-orchestrator` +
        ` --target ${target}` +
        ` --no-subagent-merge` +
        ` --skip-validation`,
      { GITHUB_TOKEN: "ghp_test_e2e_token" }
    );
    expect(result.exitCode).toBe(0);

    const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));

    // Only parent's direct servers — subagent servers NOT merged
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["postgres-db"]).toBeDefined();
    expect(mcpJson.mcpServers["analytics-api"]).toBeUndefined();
    expect(mcpJson.mcpServers["terraform-server"]).toBeUndefined();

    // No subagent context
    const output = JSON.parse(result.stdout);
    expect(output.subagentContext).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. air start
// ---------------------------------------------------------------------------

describe("air start", () => {
  const fixtureEnv = { AIR_CONFIG: join(FIXTURES, "air.json") };

  it("prints session config in dry-run mode", () => {
    const result = tryRun(
      "start claude --dry-run --root platform-orchestrator",
      fixtureEnv
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AIR Session Configuration");
    expect(result.stdout).toContain("claude");
    expect(result.stdout).toContain("github-server");
    expect(result.stdout).toContain("deploy");
  });

  it("dry-run with --no-subagent-merge excludes subagent artifacts", () => {
    const result = tryRun(
      "start claude --dry-run --root platform-orchestrator --no-subagent-merge",
      fixtureEnv
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AIR Session Configuration");
    // Parent's servers should be listed
    expect(result.stdout).toContain("github-server");
    expect(result.stdout).toContain("postgres-db");
    // Subagent servers should NOT be listed
    expect(result.stdout).not.toContain("analytics-api");
    expect(result.stdout).not.toContain("terraform-server");
  });

  it("succeeds when claude is on PATH", () => {
    const targetDir = createTempDir();
    const stubDir = createTempDir();
    createStubClaude(stubDir);

    // `start` runs prepareSession + spawn — secrets must be resolvable via
    // env vars and --skip-confirmation bypasses the interactive TUI.
    const result = tryRunInDir(
      "start claude --root platform-orchestrator --skip-confirmation",
      targetDir,
      {
        ...fixtureEnv,
        PATH: `${stubDir}:${process.env.PATH}`,
        GITHUB_TOKEN: "ghp_test_e2e_token",
        PG_CONNECTION_STRING: "postgresql://test:test@localhost/test",
        ANALYTICS_SECRET: "test_analytics_key",
      }
    );
    expect(result.exitCode).toBe(0);
  });

  it("fails when claude is not on PATH", () => {
    // Build a PATH that keeps node/npx but removes any directory containing
    // a `claude` binary, so the CLI's `which claude` check fails.
    const filteredPath = (process.env.PATH || "")
      .split(":")
      .filter((dir) => {
        try {
          return !existsSync(join(dir, "claude"));
        } catch {
          return true;
        }
      })
      .join(":");

    const result = tryRun(
      "start claude --root platform-orchestrator",
      { ...fixtureEnv, PATH: filteredPath }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not installed");
  });

  it("writes correct artifacts with --skip-confirmation (orchestrator root)", () => {
    const targetDir = createTempDir();
    const stubDir = createTempDir();
    createStubClaude(stubDir);

    const result = tryRunInDir(
      "start claude --root platform-orchestrator --skip-confirmation",
      targetDir,
      {
        ...fixtureEnv,
        PATH: `${stubDir}:${process.env.PATH}`,
        GITHUB_TOKEN: "ghp_test_e2e_token",
        PG_CONNECTION_STRING: "postgresql://test:test@localhost/test",
        ANALYTICS_SECRET: "test_analytics_key",
      }
    );
    expect(result.exitCode).toBe(0);

    // -- .mcp.json written with merged servers (parent + subagents) --
    const mcpJson = JSON.parse(readFileSync(join(targetDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["postgres-db"]).toBeDefined();
    expect(mcpJson.mcpServers["analytics-api"]).toBeDefined();
    expect(mcpJson.mcpServers["terraform-server"]).toBeDefined();
    expect(mcpJson.mcpServers["design-system"]).toBeUndefined();

    // -- Secrets resolved via env --
    expect(mcpJson.mcpServers["github-server"].env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "ghp_test_e2e_token"
    );

    // -- Skills injected (parent + subagents + plugin-expanded) --
    expect(existsSync(join(targetDir, ".claude", "skills", "deploy", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "incident-response", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "query-builder", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "provision-env", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "lint-fix", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "format-check", "SKILL.md"))).toBe(true);

    // -- Hooks injected --
    expect(existsSync(join(targetDir, ".claude", "hooks", "session-audit", "HOOK.json"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "hooks", "lint-check", "HOOK.json"))).toBe(true);

    // -- Skill references copied --
    expect(existsSync(join(targetDir, ".claude", "skills", "deploy", "references", "GIT_WORKFLOW.md"))).toBe(true);
  });

  it("forwards passthrough args after -- to the agent", () => {
    const targetDir = createTempDir();
    const stubDir = createTempDir();
    const argsFile = join(targetDir, "received-args.txt");
    createStubClaude(stubDir, argsFile);

    const result = tryRunInDir(
      `start claude --root frontend-app --skip-confirmation -- --verbose -p "test prompt"`,
      targetDir,
      {
        ...fixtureEnv,
        PATH: `${stubDir}:${process.env.PATH}`,
        GITHUB_TOKEN: "ghp_test_e2e_token",
        AIR_TEST_ARGS_FILE: argsFile,
      }
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(argsFile)).toBe(true);

    const receivedArgs = readFileSync(argsFile, "utf-8");
    expect(receivedArgs).toContain("--verbose");
    expect(receivedArgs).toContain("-p");
    expect(receivedArgs).toContain("test prompt");
  });

  it("writes correct artifacts for frontend-app root (no subagents)", () => {
    const targetDir = createTempDir();
    const stubDir = createTempDir();
    createStubClaude(stubDir);

    const result = tryRunInDir(
      "start claude --root frontend-app --skip-confirmation",
      targetDir,
      {
        ...fixtureEnv,
        PATH: `${stubDir}:${process.env.PATH}`,
        GITHUB_TOKEN: "ghp_test_e2e_token",
      }
    );
    expect(result.exitCode).toBe(0);

    // -- Only frontend root's MCP servers --
    const mcpJson = JSON.parse(readFileSync(join(targetDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["design-system"]).toBeDefined();
    expect(mcpJson.mcpServers["postgres-db"]).toBeUndefined();
    expect(mcpJson.mcpServers["analytics-api"]).toBeUndefined();
    expect(mcpJson.mcpServers["terraform-server"]).toBeUndefined();

    // -- Frontend skills + plugin-expanded --
    expect(existsSync(join(targetDir, ".claude", "skills", "component-review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "lint-fix", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "format-check", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "skills", "deploy"))).toBe(false);

    // -- Frontend hooks only --
    expect(existsSync(join(targetDir, ".claude", "hooks", "lint-check", "HOOK.json"))).toBe(true);
    expect(existsSync(join(targetDir, ".claude", "hooks", "session-audit"))).toBe(false);
  });

  it("skips subagent merge with --no-subagent-merge on start", () => {
    const targetDir = createTempDir();
    const stubDir = createTempDir();
    createStubClaude(stubDir);

    const result = tryRunInDir(
      "start claude --root platform-orchestrator --skip-confirmation --no-subagent-merge",
      targetDir,
      {
        ...fixtureEnv,
        PATH: `${stubDir}:${process.env.PATH}`,
        GITHUB_TOKEN: "ghp_test_e2e_token",
        PG_CONNECTION_STRING: "postgresql://test:test@localhost/test",
        ANALYTICS_SECRET: "test_analytics_key",
      }
    );
    expect(result.exitCode).toBe(0);

    // Only parent's MCP servers — subagent servers NOT merged
    const mcpJson = JSON.parse(readFileSync(join(targetDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["postgres-db"]).toBeDefined();
    // Subagent servers should NOT be present
    expect(mcpJson.mcpServers["analytics-api"]).toBeUndefined();
    expect(mcpJson.mcpServers["terraform-server"]).toBeUndefined();
  });

  it("completes in non-TTY mode without --skip-confirmation", () => {
    const targetDir = createTempDir();
    const stubDir = createTempDir();
    createStubClaude(stubDir);

    // No --skip-confirmation: since stdio is piped (non-TTY), TUI is
    // skipped automatically and root defaults are used.
    const result = tryRunInDir(
      "start claude --root frontend-app",
      targetDir,
      {
        ...fixtureEnv,
        PATH: `${stubDir}:${process.env.PATH}`,
        GITHUB_TOKEN: "ghp_test_e2e_token",
      }
    );
    expect(result.exitCode).toBe(0);

    // Artifacts should still be written using root defaults
    expect(existsSync(join(targetDir, ".mcp.json"))).toBe(true);
    const mcpJson = JSON.parse(readFileSync(join(targetDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["github-server"]).toBeDefined();
    expect(mcpJson.mcpServers["design-system"]).toBeDefined();
  });
});
