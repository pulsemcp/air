import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { CursorAdapter } from "../src/cursor-adapter.js";
import { loadManifest } from "@pulsemcp/air-core";
import type {
  ResolvedArtifacts,
  McpServerEntry,
  RootEntry,
} from "@pulsemcp/air-core";

function emptyArtifacts(): ResolvedArtifacts {
  return {
    skills: {},
    references: {},
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
  };
}

function readMcp(dir: string): Record<string, any> {
  const path = join(dir, ".cursor", "mcp.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readHooks(dir: string): Record<string, any> {
  const path = join(dir, ".cursor", "hooks.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Resolve a fixture *source* path inside the test's own unique temp dir.
 *
 * Fixture sources must never live in a sibling of the temp dir. The old
 * `join(dir, "..", "skills", "deploy")` pattern resolved to the same
 * `<tmpdir>/skills/deploy` for every test file, so vitest's parallel workers
 * all wrote there and clobbered each other's content between write and read.
 * The `__src__/` prefix keeps sources unique per test, cleaned up by the
 * `afterEach` rmSync, and clear of the trees the adapter itself reads or
 * writes (.cursor/).
 */
function srcPath(dir: string, ...segments: string[]): string {
  return join(dir, "__src__", ...segments);
}

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  describe("metadata", () => {
    it("has correct name and displayName", () => {
      expect(adapter.name).toBe("cursor");
      expect(adapter.displayName).toBe("Cursor");
    });
  });

  describe("translateMcpServersByShort", () => {
    it("translates stdio servers with literal env, stripping metadata", () => {
      const servers: Record<string, McpServerEntry> = {
        github: {
          title: "GitHub",
          description: "GitHub MCP",
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github@1.0.0"],
          env: { LOG_LEVEL: "debug" },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.github).toEqual({
        command: "npx",
        args: ["-y", "@mcp/github@1.0.0"],
        env: { LOG_LEVEL: "debug" },
      });
      // No title/description leak into the Cursor config.
      expect(result.github.title).toBeUndefined();
      expect(result.github.description).toBeUndefined();
    });

    it("rewrites a ${VAR} env reference to Cursor's ${env:VAR} without warning", () => {
      const servers: Record<string, McpServerEntry> = {
        github: {
          type: "stdio",
          command: "npx",
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        expect(result.github.env).toEqual({ GITHUB_TOKEN: "${env:GITHUB_TOKEN}" });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("rewrites a renamed ${VAR} env reference cleanly (no warning)", () => {
      const servers: Record<string, McpServerEntry> = {
        github: {
          type: "stdio",
          command: "npx",
          env: { TOKEN: "${GITHUB_TOKEN}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        // Cursor's ${env:VAR} works for renamed refs, so it forwards cleanly.
        expect(result.github.env).toEqual({ TOKEN: "${env:GITHUB_TOKEN}" });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("rewrites a partial ${VAR} header cleanly (no warning)", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: { Authorization: "Bearer ${API_TOKEN}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        // Cursor interpolation works mid-string, so a partial value forwards.
        expect(result.remote.headers).toEqual({
          Authorization: "Bearer ${env:API_TOKEN}",
        });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("does not rewrite or warn for a literal env value without a ${VAR}", () => {
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "run",
          env: { LOG_LEVEL: "debug" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        expect(result.srv.env).toEqual({ LOG_LEVEL: "debug" });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("rewrites a mix of whole-value, renamed, and literal env values", () => {
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "run",
          env: {
            API_KEY: "${API_KEY}",
            LOG_LEVEL: "debug",
            RENAMED: "${OTHER}",
          },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        expect(result.srv.env).toEqual({
          API_KEY: "${env:API_KEY}",
          LOG_LEVEL: "debug",
          RENAMED: "${env:OTHER}",
        });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("leaves Cursor built-in tokens and existing ${env:…} refs untouched", () => {
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "run",
          env: {
            HOME_BIN: "${userHome}/bin",
            WORK: "${workspaceFolder}",
            ALREADY: "${env:PRESET}",
            MIXED: "${userHome}/${SECRET}",
          },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.srv.env).toEqual({
        HOME_BIN: "${userHome}/bin",
        WORK: "${workspaceFolder}",
        ALREADY: "${env:PRESET}",
        // Built-in left as-is; only the real var is wrapped.
        MIXED: "${userHome}/${env:SECRET}",
      });
    });

    it("translates remote servers to a url-based entry", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.remote).toEqual({ url: "https://mcp.example.com/api" });
    });

    it("rewrites a ${VAR} header and preserves literal headers", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: {
            Authorization: "${API_TOKEN}",
            "X-Static": "always",
          },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.remote.url).toBe("https://mcp.example.com/api");
      expect(result.remote.headers).toEqual({
        Authorization: "${env:API_TOKEN}",
        "X-Static": "always",
      });
    });

    it("handles sse servers via the same url-based shape", () => {
      const servers: Record<string, McpServerEntry> = {
        events: {
          type: "sse",
          url: "https://mcp.example.com/sse",
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.events).toEqual({ url: "https://mcp.example.com/sse" });
    });
  });

  describe("translatePlugin", () => {
    it("returns an informational descriptor with name + description", () => {
      const result = adapter.translatePlugin("my-plugin", {
        description: "My plugin",
        version: "1.2.3",
      });
      expect(result).toEqual({
        name: "my-plugin",
        description: "My plugin",
        version: "1.2.3",
      });
    });

    it("omits version when absent", () => {
      const result = adapter.translatePlugin("p", { description: "d" });
      expect(result).toEqual({ name: "p", description: "d" });
    });
  });

  describe("buildStartCommand", () => {
    it("runs cursor-agent with no extra flags, anchored at the work dir", () => {
      const cmd = adapter.buildStartCommand({
        agent: "cursor",
        workDir: "/tmp/session",
        env: { FOO: "bar" },
      });
      expect(cmd.command).toBe("cursor-agent");
      expect(cmd.args).toEqual([]);
      expect(cmd.cwd).toBe("/tmp/session");
      expect(cmd.env).toEqual({ FOO: "bar" });
    });
  });

  describe("prepareSession", () => {
    let tempDir: string;
    let airHomeDir: string;
    let originalAirHome: string | undefined;

    function createTempDir(): string {
      tempDir = resolve(
        tmpdir(),
        `air-cursor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(tempDir, { recursive: true });
      return tempDir;
    }

    beforeEach(() => {
      airHomeDir = resolve(
        tmpdir(),
        `air-cursor-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      originalAirHome = process.env.AIR_HOME;
      process.env.AIR_HOME = airHomeDir;
    });

    afterEach(() => {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      if (airHomeDir && existsSync(airHomeDir)) {
        rmSync(airHomeDir, { recursive: true, force: true });
      }
      if (originalAirHome === undefined) {
        delete process.env.AIR_HOME;
      } else {
        process.env.AIR_HOME = originalAirHome;
      }
    });

    it("writes .cursor/mcp.json with translated MCP servers", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["@local/github"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@mcp/github"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_mcp_servers: ["github"],
      };

      const result = await adapter.prepareSession(artifacts, dir, { root });

      // configFiles is intentionally empty (secrets are Cursor-native ${env:VAR}).
      expect(result.configFiles).toEqual([]);

      const config = readMcp(dir);
      expect(config.mcpServers.github.command).toBe("npx");
      expect(config.mcpServers.github.args).toEqual(["-y", "@mcp/github"]);
      expect(config.mcpServers.github.env).toEqual({
        GITHUB_TOKEN: "${env:GITHUB_TOKEN}",
      });
    });

    it("rewrites ${VAR} to Cursor's ${env:VAR} in the written file", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["@local/server"] = {
        type: "stdio",
        command: "run",
        env: { API_KEY: "${API_KEY}" },
      };

      const root: RootEntry = {
        description: "Test",
        default_mcp_servers: ["server"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const raw = readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8");
      expect(raw).toContain("${env:API_KEY}");
      // The un-prefixed AIR placeholder must not survive.
      expect(raw).not.toMatch(/\$\{API_KEY\}/);
    });

    it("preserves user-authored MCP servers and top-level keys", async () => {
      const dir = createTempDir();

      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(
        join(dir, ".cursor", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "user-mcp": { command: "user-cmd" },
          },
        })
      );

      const artifacts = emptyArtifacts();
      artifacts.mcp["@local/air-mcp"] = { type: "stdio", command: "air-cmd" };
      const root: RootEntry = {
        description: "Test",
        default_mcp_servers: ["air-mcp"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const config = readMcp(dir);
      expect(config.mcpServers["user-mcp"].command).toBe("user-cmd");
      expect(config.mcpServers["air-mcp"].command).toBe("air-cmd");
    });

    it("injects skills into .cursor/skills/", async () => {
      const dir = createTempDir();

      const skillSrcDir = srcPath(dir, "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(
        join(skillSrcDir, "SKILL.md"),
        "---\nname: deploy\n---\n# Deploy"
      );

      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: resolve(skillSrcDir),
      };

      const root: RootEntry = {
        description: "Test",
        default_skills: ["deploy"],
      };

      const result = await adapter.prepareSession(artifacts, dir, { root });

      const skillMd = join(dir, ".cursor", "skills", "deploy", "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, "utf-8")).toContain("# Deploy");
      expect(result.skillPaths).toHaveLength(1);
    });

    it("copies skill references into a references/ subdir", async () => {
      const dir = createTempDir();

      const skillSrcDir = srcPath(dir, "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");

      const refSrcDir = srcPath(dir, "references");
      mkdirSync(refSrcDir, { recursive: true });
      writeFileSync(join(refSrcDir, "RUNBOOK.md"), "# Runbook");

      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: resolve(skillSrcDir),
        references: ["@local/runbook"],
      };
      artifacts.references["@local/runbook"] = {
        description: "Runbook",
        path: resolve(refSrcDir, "RUNBOOK.md"),
      };

      const root: RootEntry = {
        description: "Test",
        default_skills: ["deploy"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const refPath = join(
        dir,
        ".cursor",
        "skills",
        "deploy",
        "references",
        "RUNBOOK.md"
      );
      expect(existsSync(refPath)).toBe(true);
      expect(readFileSync(refPath, "utf-8")).toContain("# Runbook");
    });

    it("does not overwrite a skill that already exists locally", async () => {
      const dir = createTempDir();

      const localSkillDir = join(dir, ".cursor", "skills", "deploy");
      mkdirSync(localSkillDir, { recursive: true });
      writeFileSync(join(localSkillDir, "SKILL.md"), "# Local Deploy");

      const skillSrcDir = srcPath(dir, "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(join(skillSrcDir, "SKILL.md"), "# Catalog Deploy");

      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: resolve(skillSrcDir),
      };

      const root: RootEntry = {
        description: "Test",
        default_skills: ["deploy"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      expect(
        readFileSync(join(localSkillDir, "SKILL.md"), "utf-8")
      ).toContain("# Local Deploy");
    });

    it("loads no artifacts when no root is provided", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["@local/github"] = { type: "stdio", command: "gh" };

      const result = await adapter.prepareSession(artifacts, dir);

      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
      expect(existsSync(join(dir, ".cursor", "hooks.json"))).toBe(false);
      expect(result.skillPaths).toEqual([]);
      expect(result.hookPaths).toEqual([]);
    });

    describe("hooks", () => {
      it("injects a path-based hook and registers it under the mapped event", async () => {
        const dir = createTempDir();

        const hookSrcDir = srcPath(dir, "hooks", "guard");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({
            event: "pre_tool_call",
            command: "./run.sh",
            matcher: "Shell",
          })
        );
        writeFileSync(join(hookSrcDir, "run.sh"), "#!/bin/bash\necho guard");

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/guard"] = {
          description: "Guard",
          path: resolve(hookSrcDir),
        };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["guard"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        expect(
          existsSync(join(dir, ".cursor", "hooks", "guard", "run.sh"))
        ).toBe(true);
        expect(result.hookPaths).toHaveLength(1);

        const config = readHooks(dir);
        expect(config.version).toBe(1);
        const entries = config.hooks.preToolUse;
        expect(entries).toHaveLength(1);
        expect(entries[0].matcher).toBe("Shell");
        expect(entries[0]._air_hook_id).toBe("guard");
        // hook-relative command is anchored to the repo root.
        expect(entries[0].command).toContain("git rev-parse --show-toplevel");
        expect(entries[0].command).toContain(".cursor/hooks/guard/run.sh");
      });

      it("maps camelCase Cursor event names as identity", async () => {
        const dir = createTempDir();

        const hookSrcDir = srcPath(dir, "hooks", "on-edit");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "afterFileEdit", command: "echo hi" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/on-edit"] = {
          description: "On edit",
          path: resolve(hookSrcDir),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_hooks: ["on-edit"] },
        });

        const config = readHooks(dir);
        expect(config.hooks.afterFileEdit).toHaveLength(1);
      });

      it("warns and skips a hook with an unrecognized event", async () => {
        const dir = createTempDir();

        const hookSrcDir = srcPath(dir, "hooks", "weird");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "notification", command: "echo" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/weird"] = {
          description: "Weird",
          path: resolve(hookSrcDir),
        };

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_hooks: ["weird"] },
        });
        warn.mockRestore();

        // The directory is still copied, but no hook entry is registered.
        expect(existsSync(join(dir, ".cursor", "hooks", "weird"))).toBe(true);
        expect(existsSync(join(dir, ".cursor", "hooks.json"))).toBe(false);
      });

      it("re-registers a previously AIR-managed hook whose directory already exists", async () => {
        const dir = createTempDir();

        const hookSrcDir = srcPath(dir, "hooks", "guard");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo hi" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/guard"] = {
          description: "Guard",
          path: resolve(hookSrcDir),
        };
        const root: RootEntry = { description: "Test", default_hooks: ["guard"] };

        // First run materializes the dir + registers the entry.
        await adapter.prepareSession(artifacts, dir, { root });
        expect(existsSync(join(dir, ".cursor", "hooks", "guard"))).toBe(true);
        expect(readHooks(dir).hooks.sessionStart).toHaveLength(1);

        // Second run: the hook dir already exists and was AIR-managed
        // (prevHookIds has it), so the registration is rebuilt rather than
        // skipped — no duplicate, exactly one entry remains.
        const result = await adapter.prepareSession(artifacts, dir, { root });
        const config = readHooks(dir);
        expect(config.hooks.sessionStart).toHaveLength(1);
        expect(config.hooks.sessionStart[0]._air_hook_id).toBe("guard");
        expect(result.hookActivations.map((a) => a.short)).toEqual(["guard"]);
      });

      it("passes timeout_seconds through as timeout", async () => {
        const dir = createTempDir();

        const hookSrcDir = srcPath(dir, "hooks", "slow");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({
            event: "stop",
            command: "echo done",
            timeout_seconds: 30,
          })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/slow"] = {
          description: "Slow",
          path: resolve(hookSrcDir),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_hooks: ["slow"] },
        });

        const config = readHooks(dir);
        expect(config.hooks.stop[0].timeout).toBe(30);
      });

      it("preserves user-authored hooks when registering AIR hooks", async () => {
        const dir = createTempDir();

        mkdirSync(join(dir, ".cursor"), { recursive: true });
        writeFileSync(
          join(dir, ".cursor", "hooks.json"),
          JSON.stringify({
            version: 1,
            hooks: {
              beforeShellExecution: [{ command: "user-guard.sh" }],
            },
          })
        );

        const hookSrcDir = srcPath(dir, "hooks", "guard");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo hi" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/guard"] = {
          description: "Guard",
          path: resolve(hookSrcDir),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_hooks: ["guard"] },
        });

        const config = readHooks(dir);
        // User hook untouched, AIR hook added.
        expect(config.hooks.beforeShellExecution).toEqual([
          { command: "user-guard.sh" },
        ]);
        expect(config.hooks.sessionStart).toHaveLength(1);
        expect(config.hooks.sessionStart[0]._air_hook_id).toBe("guard");
      });
    });

    describe("activation validation", () => {
      it("throws on an unknown MCP server ID", async () => {
        const dir = createTempDir();
        await expect(
          adapter.prepareSession(emptyArtifacts(), dir, {
            root: { description: "Test", default_mcp_servers: ["nope"] },
          })
        ).rejects.toThrow(/Unknown MCP server ID "nope"/);
      });

      it("throws on a shortname collision across scopes", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.mcp["@a/github"] = { type: "stdio", command: "a" };
        artifacts.mcp["@b/github"] = { type: "stdio", command: "b" };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            root: {
              description: "Test",
              default_mcp_servers: ["@a/github", "@b/github"],
            },
          })
        ).rejects.toThrow(/shortname collision/);
      });
    });

    describe("manifest reconciliation", () => {
      function writeSkillSrc(dir: string, id: string): string {
        const src = srcPath(dir, `src-${id}`, "skills", id);
        mkdirSync(src, { recursive: true });
        writeFileSync(join(src, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}`);
        return resolve(src);
      }

      function writeHookSrc(dir: string, id: string, command: string): string {
        const src = srcPath(dir, `src-${id}`, "hooks", id);
        mkdirSync(src, { recursive: true });
        writeFileSync(
          join(src, "HOOK.json"),
          JSON.stringify({ event: "session_start", command })
        );
        return resolve(src);
      }

      it("records activated artifacts in the manifest", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };
        artifacts.mcp["@local/mcp-a"] = { type: "stdio", command: "cmd-a" };

        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["skill-a"],
            default_mcp_servers: ["mcp-a"],
          },
        });

        const manifest = loadManifest(dir);
        expect(manifest?.adapter).toBe("cursor");
        expect(manifest?.skills).toEqual(["skill-a"]);
        expect(manifest?.mcpServers).toEqual(["mcp-a"]);
      });

      it("removes stale skills, hooks, and MCP servers on re-run", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };
        artifacts.skills["@local/skill-b"] = {
          description: "B",
          path: writeSkillSrc(dir, "skill-b"),
        };
        artifacts.hooks["@local/hook-a"] = {
          description: "A",
          path: writeHookSrc(dir, "hook-a", "cmd-a"),
        };
        artifacts.hooks["@local/hook-b"] = {
          description: "B",
          path: writeHookSrc(dir, "hook-b", "cmd-b"),
        };
        artifacts.mcp["@local/mcp-a"] = { type: "stdio", command: "cmd-a" };
        artifacts.mcp["@local/mcp-b"] = { type: "stdio", command: "cmd-b" };

        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["skill-a", "skill-b"],
            default_hooks: ["hook-a", "hook-b"],
            default_mcp_servers: ["mcp-a", "mcp-b"],
          },
        });

        expect(existsSync(join(dir, ".cursor", "skills", "skill-b"))).toBe(true);
        expect(existsSync(join(dir, ".cursor", "hooks", "hook-b"))).toBe(true);
        {
          const config = readMcp(dir);
          expect(Object.keys(config.mcpServers).sort()).toEqual([
            "mcp-a",
            "mcp-b",
          ]);
          expect(readHooks(dir).hooks.sessionStart).toHaveLength(2);
        }

        // Second run drops the -b variants.
        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["skill-a"],
            default_hooks: ["hook-a"],
            default_mcp_servers: ["mcp-a"],
          },
        });

        expect(existsSync(join(dir, ".cursor", "skills", "skill-a"))).toBe(true);
        expect(existsSync(join(dir, ".cursor", "skills", "skill-b"))).toBe(false);
        expect(existsSync(join(dir, ".cursor", "hooks", "hook-a"))).toBe(true);
        expect(existsSync(join(dir, ".cursor", "hooks", "hook-b"))).toBe(false);

        const config = readMcp(dir);
        expect(Object.keys(config.mcpServers)).toEqual(["mcp-a"]);
        const hooks = readHooks(dir);
        expect(hooks.hooks.sessionStart).toHaveLength(1);
        expect(hooks.hooks.sessionStart[0]._air_hook_id).toBe("hook-a");
      });
    });

    describe("cleanSession", () => {
      it("removes all AIR-managed artifacts and deletes the manifest", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const skillSrc = srcPath(dir, "skills", "deploy");
        mkdirSync(skillSrc, { recursive: true });
        writeFileSync(join(skillSrc, "SKILL.md"), "# Deploy");

        const hookSrc = srcPath(dir, "hooks", "guard");
        mkdirSync(hookSrc, { recursive: true });
        writeFileSync(
          join(hookSrc, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo" })
        );

        artifacts.skills["@local/deploy"] = {
          id: "deploy",
          description: "Deploy",
          path: resolve(skillSrc),
        };
        artifacts.hooks["@local/guard"] = {
          description: "Guard",
          path: resolve(hookSrc),
        };
        artifacts.mcp["@local/github"] = { type: "stdio", command: "gh" };

        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["deploy"],
            default_hooks: ["guard"],
            default_mcp_servers: ["github"],
          },
        });

        const result = await adapter.cleanSession(dir);

        expect(result.removedSkills).toEqual(["deploy"]);
        expect(result.removedHooks).toEqual(["guard"]);
        expect(result.removedMcpServers).toEqual(["github"]);
        expect(result.manifestRemoved).toBe(true);
        expect(existsSync(join(dir, ".cursor", "skills", "deploy"))).toBe(false);
        expect(existsSync(join(dir, ".cursor", "hooks", "guard"))).toBe(false);
        // Both config files had only AIR-owned content, so they are deleted.
        expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
        expect(existsSync(join(dir, ".cursor", "hooks.json"))).toBe(false);
      });

      it("preserves user-authored MCP servers when pruning", async () => {
        const dir = createTempDir();

        mkdirSync(join(dir, ".cursor"), { recursive: true });
        writeFileSync(
          join(dir, ".cursor", "mcp.json"),
          JSON.stringify({ mcpServers: { "user-mcp": { command: "user-cmd" } } })
        );

        const artifacts = emptyArtifacts();
        artifacts.mcp["@local/github"] = { type: "stdio", command: "gh" };
        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_mcp_servers: ["github"] },
        });

        await adapter.cleanSession(dir);

        const config = readMcp(dir);
        expect(config.mcpServers["user-mcp"].command).toBe("user-cmd");
        expect(config.mcpServers.github).toBeUndefined();
      });

      it("returns an empty result when there is no manifest", async () => {
        const dir = createTempDir();
        const result = await adapter.cleanSession(dir);
        expect(result.removedSkills).toEqual([]);
        expect(result.removedHooks).toEqual([]);
        expect(result.removedMcpServers).toEqual([]);
        expect(result.manifestExisted).toBe(false);
      });

      it("prunes hooks but keeps MCP servers with keepMcpServers", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const hookSrc = srcPath(dir, "hooks", "guard");
        mkdirSync(hookSrc, { recursive: true });
        writeFileSync(
          join(hookSrc, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo" })
        );

        artifacts.hooks["@local/guard"] = {
          description: "Guard",
          path: resolve(hookSrc),
        };
        artifacts.mcp["@local/github"] = { type: "stdio", command: "gh" };

        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_hooks: ["guard"],
            default_mcp_servers: ["github"],
          },
        });

        // MCP and hooks live in separate files — clean hooks, keep MCP.
        const result = await adapter.cleanSession(dir, { keepMcpServers: true });

        expect(result.removedHooks).toEqual(["guard"]);
        expect(result.removedMcpServers).toEqual([]);
        expect(existsSync(join(dir, ".cursor", "hooks", "guard"))).toBe(false);

        // The MCP server survives; the hooks file had only the AIR hook, so it
        // is deleted entirely.
        const config = readMcp(dir);
        expect(config.mcpServers.github.command).toBe("gh");
        expect(existsSync(join(dir, ".cursor", "hooks.json"))).toBe(false);

        // The manifest is rewritten (not deleted) with the kept MCP server.
        const manifest = loadManifest(dir);
        expect(manifest?.mcpServers).toEqual(["github"]);
        expect(manifest?.hooks ?? []).toEqual([]);
      });
    });
  });

  describe("listLocalArtifacts", () => {
    it("surfaces skills checked into .cursor/skills/", async () => {
      const dir = resolve(
        tmpdir(),
        `air-cursor-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(join(dir, ".cursor", "skills", "local-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(dir, ".cursor", "skills", "local-skill", "SKILL.md"),
        "---\ndescription: Local\n---\n"
      );

      try {
        const result = await adapter.listLocalArtifacts(dir);
        expect(result.skills?.map((s) => s.id)).toEqual(["local-skill"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
