import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { parse as parseToml } from "smol-toml";
import { CodexAdapter } from "../src/codex-adapter.js";
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

function readConfig(dir: string): Record<string, any> {
  const path = join(dir, ".codex", "config.toml");
  return parseToml(readFileSync(path, "utf-8")) as Record<string, any>;
}

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  describe("metadata", () => {
    it("has correct name and displayName", () => {
      expect(adapter.name).toBe("codex");
      expect(adapter.displayName).toBe("OpenAI Codex");
    });
  });

  describe("translateMcpServersByShort", () => {
    it("translates stdio servers with literal env into an env table", () => {
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
      // No title/description leak into the Codex config.
      expect(result.github.title).toBeUndefined();
      expect(result.github.description).toBeUndefined();
    });

    it("forwards a ${VAR} env reference whose key matches via env_vars", () => {
      const servers: Record<string, McpServerEntry> = {
        github: {
          type: "stdio",
          command: "npx",
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.github.env_vars).toEqual(["GITHUB_TOKEN"]);
      expect(result.github.env).toBeUndefined();
    });

    it("rebinds a renamed ${VAR} env reference via a sh -c shim and forwards the source var", () => {
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
        // Codex's env_vars can only forward same-named host vars, so a rename is
        // expressed as a sh -c shim that rebinds TOKEN from the forwarded
        // GITHUB_TOKEN right before exec — keeping the secret value off disk.
        expect(result.github.command).toBe("sh");
        expect(result.github.args).toEqual([
          "-c",
          `TOKEN="\${GITHUB_TOKEN}" exec 'npx'`,
        ]);
        expect(result.github.env_vars).toEqual(["GITHUB_TOKEN"]);
        expect(result.github.env).toBeUndefined();
        // No warning — the rename now forwards correctly.
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("rebinds a partial Bearer-style ${VAR} env value via a sh -c shim", () => {
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "run",
          args: ["--serve"],
          env: { AUTH: "Bearer ${TOKEN}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        // The secret is embedded in a larger string, so the shim templates the
        // value as a shell double-quoted string and forwards the source var.
        expect(result.srv.command).toBe("sh");
        expect(result.srv.args).toEqual([
          "-c",
          `AUTH="Bearer \${TOKEN}" exec 'run' '--serve'`,
        ]);
        expect(result.srv.env_vars).toEqual(["TOKEN"]);
        expect(result.srv.env).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("maps an Authorization: Bearer ${VAR} header to bearer_token_env_var", () => {
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
        // Codex emits the Authorization header itself from the env var, so it is
        // not also written literally to http_headers.
        expect(result.remote.bearer_token_env_var).toBe("API_TOKEN");
        expect(result.remote.http_headers).toBeUndefined();
        expect(result.remote.env_http_headers).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("warns and keeps a non-Bearer partial header literal (no Codex expression)", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: { "X-Api-Key": "key-${SECRET}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        // A remote server has no launch process to wrap, and env_http_headers /
        // bearer_token_env_var can't express an arbitrary partial header — so it
        // stays literal and warns.
        expect(result.remote.http_headers).toEqual({ "X-Api-Key": "key-${SECRET}" });
        expect(result.remote.env_http_headers).toBeUndefined();
        expect(result.remote.bearer_token_env_var).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("remote");
        expect(warn.mock.calls[0][0]).toContain("${SECRET}");
      } finally {
        warn.mockRestore();
      }
    });

    it("does not warn for a literal env value without a ${VAR}", () => {
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

    it("splits mixed env into env_vars + a sh -c shim + a literal env table", () => {
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
        // Same-named ref forwards natively; the renamed ref is rebound in a shim
        // (forwarding OTHER); the literal stays in the env table.
        expect(result.srv.command).toBe("sh");
        expect(result.srv.args).toEqual([
          "-c",
          `RENAMED="\${OTHER}" exec 'run'`,
        ]);
        expect(result.srv.env_vars).toEqual(["API_KEY", "OTHER"]);
        expect(result.srv.env).toEqual({ LOG_LEVEL: "debug" });
        // Everything forwards now — no warning.
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("does NOT shim a ${VAR} reference carrying shell syntax — keeps it literal + warns", () => {
      // The `${...}` capture is permissive, so a value like `${X:-$(cmd)}` would
      // smuggle shell default-value/command-substitution syntax into the rebind
      // shim and the sub-shell would execute it. Such values must never reach the
      // shell: keep the command real, the value literal, and warn.
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "run",
          env: { EVIL: "${X:-$(touch /tmp/pwned)}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        // No shim — the real command is preserved unchanged.
        expect(result.srv.command).toBe("run");
        expect(result.srv.args).toBeUndefined();
        expect(result.srv.env_vars).toBeUndefined();
        // The dangerous value is kept literal (Codex injects it verbatim).
        expect(result.srv.env).toEqual({ EVIL: "${X:-$(touch /tmp/pwned)}" });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it("does NOT shim when the env KEY itself carries shell metacharacters", () => {
      // The env name is interpolated on the assignment's left-hand side
      // (`KEY=...`), so a key like `A;rm -rf /` would terminate the assignment and
      // run a command. Reject it the same way.
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "run",
          env: { "A;rm -rf /": "${TOKEN}" },
        },
      };

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = adapter.translateMcpServersByShort(servers);
        expect(result.srv.command).toBe("run");
        expect(result.srv.env_vars).toBeUndefined();
        expect(result.srv.env).toEqual({ "A;rm -rf /": "${TOKEN}" });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it("end-to-end: a shell-syntax value is inert when the (literal) env is applied", () => {
      // Belt-and-suspenders: prove the kept-literal value never executes. We build
      // the same literal env Codex would inject and confirm no command ran.
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "printenv",
          args: ["EVIL"],
          env: { EVIL: "${X:-$(echo INJECTED >&2)}" },
        },
      };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let result: Record<string, any>;
      try {
        result = adapter.translateMcpServersByShort(servers);
      } finally {
        warn.mockRestore();
      }
      // No shim was produced, so there is no `sh -c` wrapper to execute. Codex
      // would set env EVIL to the literal string and run `printenv EVIL`; emulate
      // that and confirm the literal is echoed verbatim (no INJECTED on stderr).
      const out = execFileSync("printenv", ["EVIL"], {
        env: { ...process.env, EVIL: result.srv.env.EVIL as string },
        encoding: "utf-8",
      });
      expect(out.trim()).toBe("${X:-$(echo INJECTED >&2)}");
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

    it("maps a ${VAR} header to env_http_headers and literal headers to http_headers", () => {
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
      expect(result.remote.env_http_headers).toEqual({
        Authorization: "API_TOKEN",
      });
      expect(result.remote.http_headers).toEqual({ "X-Static": "always" });
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

    it("emits a per-server oauth.client_id for a remote server (redirectUri is global)", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          oauth: {
            clientId: "air-registered-client",
            redirectUri: "https://cb.example.com/callback",
          },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.remote.url).toBe("https://mcp.example.com/api");
      // client_id is per-server; the redirect URI is global and not emitted here.
      expect(result.remote.oauth).toEqual({ client_id: "air-registered-client" });
    });

    it("omits the oauth table when no clientId is configured", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          oauth: { redirectUri: "https://cb.example.com/callback" },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.remote.oauth).toBeUndefined();
    });
  });

  // Runtime proof that the sh -c shim actually rebinds the renamed/partial env
  // var inside the spawned child — not just that the emitted TOML looks right.
  describe("sh -c shim runtime behavior", () => {
    it("rebinds a renamed env var so the child process sees the forwarded value", () => {
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "printenv",
          args: ["DEST_KEY"],
          env: { DEST_KEY: "${SRC_KEY}" },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.srv.command).toBe("sh");
      expect(result.srv.env_vars).toEqual(["SRC_KEY"]);

      // Codex would forward SRC_KEY from the host env into the sub-shell; we
      // emulate that here and run the produced command verbatim.
      const out = execFileSync(
        result.srv.command as string,
        result.srv.args as string[],
        { env: { ...process.env, SRC_KEY: "s3cr3t-renamed" }, encoding: "utf-8" }
      );
      expect(out.trim()).toBe("s3cr3t-renamed");
    });

    it("rebinds a partial Bearer-style env value at runtime", () => {
      const servers: Record<string, McpServerEntry> = {
        srv: {
          type: "stdio",
          command: "printenv",
          args: ["AUTH"],
          env: { AUTH: "Bearer ${TOKEN}" },
        },
      };

      const result = adapter.translateMcpServersByShort(servers);
      expect(result.srv.env_vars).toEqual(["TOKEN"]);

      const out = execFileSync(
        result.srv.command as string,
        result.srv.args as string[],
        { env: { ...process.env, TOKEN: "abc123" }, encoding: "utf-8" }
      );
      expect(out.trim()).toBe("Bearer abc123");
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
    it("runs codex with no extra flags, anchored at the work dir", () => {
      const cmd = adapter.buildStartCommand({
        agent: "codex",
        workDir: "/tmp/session",
        env: { FOO: "bar" },
      });
      expect(cmd.command).toBe("codex");
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
        `air-codex-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(tempDir, { recursive: true });
      return tempDir;
    }

    beforeEach(() => {
      airHomeDir = resolve(
        tmpdir(),
        `air-codex-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

    it("writes .codex/config.toml with translated MCP servers", async () => {
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

      // configFiles is intentionally empty (TOML is outside AIR's JSON pipeline).
      expect(result.configFiles).toEqual([]);

      const config = readConfig(dir);
      expect(config.mcp_servers.github.command).toBe("npx");
      expect(config.mcp_servers.github.args).toEqual(["-y", "@mcp/github"]);
      expect(config.mcp_servers.github.env_vars).toEqual(["GITHUB_TOKEN"]);
    });

    it("forwards a same-named ${VAR} via env_vars instead of writing it literally", async () => {
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

      const raw = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
      expect(raw).not.toContain("${");
      expect(raw).toContain("env_vars");
    });

    it("preserves user-authored MCP servers and top-level keys", async () => {
      const dir = createTempDir();

      mkdirSync(join(dir, ".codex"), { recursive: true });
      writeFileSync(
        join(dir, ".codex", "config.toml"),
        [
          'model = "o3"',
          "",
          "[mcp_servers.user-mcp]",
          'command = "user-cmd"',
          "",
        ].join("\n")
      );

      const artifacts = emptyArtifacts();
      artifacts.mcp["@local/air-mcp"] = { type: "stdio", command: "air-cmd" };
      const root: RootEntry = {
        description: "Test",
        default_mcp_servers: ["air-mcp"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const config = readConfig(dir);
      expect(config.model).toBe("o3");
      expect(config.mcp_servers["user-mcp"].command).toBe("user-cmd");
      expect(config.mcp_servers["air-mcp"].command).toBe("air-cmd");
    });

    it("emits per-server oauth.client_id and a global mcp_oauth_callback_url", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["@local/remote"] = {
        type: "streamable-http",
        url: "https://mcp.example.com/api",
        oauth: {
          clientId: "air-registered-client",
          redirectUri: "https://cb.example.com/callback",
        },
      };

      const root: RootEntry = {
        description: "Test",
        default_mcp_servers: ["remote"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const config = readConfig(dir);
      expect(config.mcp_servers.remote.url).toBe("https://mcp.example.com/api");
      expect(config.mcp_servers.remote.oauth).toEqual({
        client_id: "air-registered-client",
      });
      // Codex has no per-server redirect URI — it lives at the top level.
      expect(config.mcp_oauth_callback_url).toBe(
        "https://cb.example.com/callback"
      );
    });

    it("warns and keeps the first URI when servers declare distinct redirect URIs", async () => {
      const dir = createTempDir();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const artifacts = emptyArtifacts();
        artifacts.mcp["@local/alpha"] = {
          type: "streamable-http",
          url: "https://alpha.example.com/api",
          oauth: {
            clientId: "alpha-client",
            redirectUri: "https://alpha.example.com/callback",
          },
        };
        artifacts.mcp["@local/beta"] = {
          type: "streamable-http",
          url: "https://beta.example.com/api",
          oauth: {
            clientId: "beta-client",
            redirectUri: "https://beta.example.com/callback",
          },
        };

        const root: RootEntry = {
          description: "Test",
          default_mcp_servers: ["alpha", "beta"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const config = readConfig(dir);
        // First-declared URI wins; the second is dropped with a warning.
        expect(config.mcp_oauth_callback_url).toBe(
          "https://alpha.example.com/callback"
        );
        expect(warn).toHaveBeenCalled();
        const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
        expect(warned).toContain("mcp_oauth_callback_url");
      } finally {
        warn.mockRestore();
      }
    });

    it("injects skills into .agents/skills/", async () => {
      const dir = createTempDir();

      const skillSrcDir = join(dir, "..", "skills", "deploy");
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

      const skillMd = join(dir, ".agents", "skills", "deploy", "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, "utf-8")).toContain("# Deploy");
      expect(result.skillPaths).toHaveLength(1);
    });

    it("copies skill references into a references/ subdir", async () => {
      const dir = createTempDir();

      const skillSrcDir = join(dir, "..", "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");

      const refSrcDir = join(dir, "..", "references");
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
        ".agents",
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

      const localSkillDir = join(dir, ".agents", "skills", "deploy");
      mkdirSync(localSkillDir, { recursive: true });
      writeFileSync(join(localSkillDir, "SKILL.md"), "# Local Deploy");

      const skillSrcDir = join(dir, "..", "skills", "deploy");
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

      expect(existsSync(join(dir, ".codex", "config.toml"))).toBe(false);
      expect(result.skillPaths).toEqual([]);
      expect(result.hookPaths).toEqual([]);
    });

    describe("hooks", () => {
      it("injects a path-based hook and registers it under the mapped event", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "guard");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({
            event: "pre_tool_call",
            command: "./run.sh",
            matcher: "Bash",
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
          existsSync(join(dir, ".codex", "hooks", "guard", "run.sh"))
        ).toBe(true);
        expect(result.hookPaths).toHaveLength(1);

        const config = readConfig(dir);
        const groups = config.hooks.PreToolUse;
        expect(groups).toHaveLength(1);
        expect(groups[0].matcher).toBe("Bash");
        const entry = groups[0].hooks[0];
        expect(entry.type).toBe("command");
        expect(entry._air_hook_id).toBe("guard");
        // hook-relative command is anchored to the repo root.
        expect(entry.command).toContain("git rev-parse --show-toplevel");
        expect(entry.command).toContain(".codex/hooks/guard/run.sh");
      });

      it("maps PascalCase Codex event names as identity", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "on-start");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "SessionStart", command: "echo hi" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["@local/on-start"] = {
          description: "On start",
          path: resolve(hookSrcDir),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_hooks: ["on-start"] },
        });

        const config = readConfig(dir);
        expect(config.hooks.SessionStart).toHaveLength(1);
      });

      it("warns and skips a hook with an unrecognized event", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "weird");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "pre_compact", command: "echo" })
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
        expect(existsSync(join(dir, ".codex", "hooks", "weird"))).toBe(true);
        expect(existsSync(join(dir, ".codex", "config.toml"))).toBe(false);
      });

      it("re-registers a previously AIR-managed hook whose directory already exists", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "guard");
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
        expect(existsSync(join(dir, ".codex", "hooks", "guard"))).toBe(true);
        expect(readConfig(dir).hooks.SessionStart).toHaveLength(1);

        // Second run: the hook dir already exists and was AIR-managed
        // (prevHookIds has it), so the registration is rebuilt rather than
        // skipped — no duplicate, exactly one entry remains.
        const result = await adapter.prepareSession(artifacts, dir, { root });
        const config = readConfig(dir);
        expect(config.hooks.SessionStart).toHaveLength(1);
        expect(config.hooks.SessionStart[0].hooks[0]._air_hook_id).toBe("guard");
        expect(
          result.hookActivations.map((a) => a.short)
        ).toEqual(["guard"]);
      });

      it("passes timeout_seconds through as timeout", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "slow");
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

        const config = readConfig(dir);
        expect(config.hooks.Stop[0].hooks[0].timeout).toBe(30);
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
        const src = join(dir, "..", `src-${id}`, "skills", id);
        mkdirSync(src, { recursive: true });
        writeFileSync(join(src, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}`);
        return resolve(src);
      }

      function writeHookSrc(dir: string, id: string, command: string): string {
        const src = join(dir, "..", `src-${id}`, "hooks", id);
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
        expect(manifest?.adapter).toBe("codex");
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

        expect(existsSync(join(dir, ".agents", "skills", "skill-b"))).toBe(true);
        expect(existsSync(join(dir, ".codex", "hooks", "hook-b"))).toBe(true);
        {
          const config = readConfig(dir);
          expect(Object.keys(config.mcp_servers).sort()).toEqual([
            "mcp-a",
            "mcp-b",
          ]);
          expect(config.hooks.SessionStart).toHaveLength(2);
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

        expect(existsSync(join(dir, ".agents", "skills", "skill-a"))).toBe(true);
        expect(existsSync(join(dir, ".agents", "skills", "skill-b"))).toBe(false);
        expect(existsSync(join(dir, ".codex", "hooks", "hook-a"))).toBe(true);
        expect(existsSync(join(dir, ".codex", "hooks", "hook-b"))).toBe(false);

        const config = readConfig(dir);
        expect(Object.keys(config.mcp_servers)).toEqual(["mcp-a"]);
        expect(config.hooks.SessionStart).toHaveLength(1);
        expect(config.hooks.SessionStart[0].hooks[0]._air_hook_id).toBe("hook-a");
      });
    });

    describe("cleanSession", () => {
      it("removes all AIR-managed artifacts and deletes the manifest", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const skillSrc = join(dir, "..", "skills", "deploy");
        mkdirSync(skillSrc, { recursive: true });
        writeFileSync(join(skillSrc, "SKILL.md"), "# Deploy");

        const hookSrc = join(dir, "..", "hooks", "guard");
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
        expect(existsSync(join(dir, ".agents", "skills", "deploy"))).toBe(false);
        expect(existsSync(join(dir, ".codex", "hooks", "guard"))).toBe(false);
        // config.toml had only AIR-owned content, so it is deleted entirely.
        expect(existsSync(join(dir, ".codex", "config.toml"))).toBe(false);
      });

      it("preserves user-authored MCP servers when pruning", async () => {
        const dir = createTempDir();

        mkdirSync(join(dir, ".codex"), { recursive: true });
        writeFileSync(
          join(dir, ".codex", "config.toml"),
          ['[mcp_servers.user-mcp]', 'command = "user-cmd"', ""].join("\n")
        );

        const artifacts = emptyArtifacts();
        artifacts.mcp["@local/github"] = { type: "stdio", command: "gh" };
        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_mcp_servers: ["github"] },
        });

        await adapter.cleanSession(dir);

        const config = readConfig(dir);
        expect(config.mcp_servers["user-mcp"].command).toBe("user-cmd");
        expect(config.mcp_servers.github).toBeUndefined();
      });

      it("returns an empty result when there is no manifest", async () => {
        const dir = createTempDir();
        const result = await adapter.cleanSession(dir);
        expect(result.removedSkills).toEqual([]);
        expect(result.removedHooks).toEqual([]);
        expect(result.removedMcpServers).toEqual([]);
        expect(result.manifestExisted).toBe(false);
      });

      it("prunes hooks but keeps MCP servers in the shared config.toml with keepMcpServers", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const hookSrc = join(dir, "..", "hooks", "guard");
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

        // Both live in the same .codex/config.toml — clean hooks, keep MCP.
        const result = await adapter.cleanSession(dir, { keepMcpServers: true });

        expect(result.removedHooks).toEqual(["guard"]);
        expect(result.removedMcpServers).toEqual([]);
        expect(existsSync(join(dir, ".codex", "hooks", "guard"))).toBe(false);

        // The MCP server survives and the hooks table is gone — the file is
        // rewritten, not deleted, because it still has AIR-managed content.
        const config = readConfig(dir);
        expect(config.mcp_servers.github.command).toBe("gh");
        expect(config.hooks).toBeUndefined();

        // The manifest is rewritten (not deleted) with the kept MCP server.
        const manifest = loadManifest(dir);
        expect(manifest?.mcpServers).toEqual(["github"]);
        expect(manifest?.hooks ?? []).toEqual([]);
      });
    });
  });

  describe("listLocalArtifacts", () => {
    it("surfaces skills checked into .agents/skills/", async () => {
      const dir = resolve(
        tmpdir(),
        `air-codex-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(join(dir, ".agents", "skills", "local-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(dir, ".agents", "skills", "local-skill", "SKILL.md"),
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
