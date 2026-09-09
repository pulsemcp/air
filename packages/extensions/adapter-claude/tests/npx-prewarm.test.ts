import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type { ResolvedArtifacts, McpServerEntry } from "@pulsemcp/air-core";

/**
 * End-to-end coverage for the npx prewarm that `prepareSession` performs.
 *
 * These tests put a fake `npx` first on PATH and let the adapter spawn it for
 * real, so they exercise the actual argument construction rather than a
 * mocked-out seam. The shim records every invocation instead of installing
 * anything, so no network is touched.
 */
const isWindows = process.platform === "win32";

function artifactsWith(mcp: Record<string, McpServerEntry>): ResolvedArtifacts {
  return { skills: {}, references: {}, mcp, plugins: {}, roots: {}, hooks: {} };
}

function stdioServer(command: string, args: string[], env?: Record<string, string>): McpServerEntry {
  return {
    title: "t",
    description: "d",
    type: "stdio",
    command,
    args,
    ...(env && { env }),
  } as McpServerEntry;
}

describe.skipIf(isWindows)("ClaudeAdapter npx prewarm", () => {
  const adapter = new ClaudeAdapter();
  let dir: string;
  let binDir: string;
  let logPath: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = join(tmpdir(), `air-prewarm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    binDir = join(dir, "__bin__");
    logPath = join(dir, "npx-invocations.log");
    mkdirSync(binDir, { recursive: true });

    const shim = join(binDir, "npx");
    writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\nexit 0\n`);
    chmodSync(shim, 0o755);

    // The failure path resolves the npm cache root to decide whether a partial
    // tree needs discarding; shimming npm keeps these tests off the real one.
    const npmShim = join(binDir, "npm");
    writeFileSync(npmShim, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(join(dir, "__cache__"))}\nexit 0\n`);
    chmodSync(npmShim, 0o755);

    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    delete process.env.AIR_NPX_PREWARM;
    rmSync(dir, { recursive: true, force: true });
  });

  function invocations(): string[] {
    return existsSync(logPath)
      ? readFileSync(logPath, "utf8").split("\n").filter(Boolean)
      : [];
  }

  it("installs a shared package once, before any server is launched", async () => {
    // The session 11638 shape: same command+args, different TOOL_GROUPS.
    const spec = "pulsemcp-cms-admin-mcp-server@latest";
    await adapter.prepareSession(
      artifactsWith({
        "@local/pulse-goodjobs-ro": stdioServer("npx", ["-y", spec], { TOOL_GROUPS: "ro" }),
        "@local/pulse-goodjobs-rw": stdioServer("npx", ["-y", spec], { TOOL_GROUPS: "rw" }),
      }),
      dir,
      { mcpServerOverrides: ["pulse-goodjobs-ro", "pulse-goodjobs-rw"] }
    );

    const calls = invocations();
    expect(calls).toHaveLength(1);
    // `--package <spec> --call <cmd>` installs the spec into the same
    // _npx/<hash> the servers will use, without running the server's own bin.
    expect(calls[0]).toBe(`--yes --package ${spec} --call node --version`);

    // .mcp.json is still written with both servers, unchanged.
    const written = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(written.mcpServers).sort()).toEqual([
      "pulse-goodjobs-ro",
      "pulse-goodjobs-rw",
    ]);
    expect(written.mcpServers["pulse-goodjobs-ro"].env).toEqual({ TOOL_GROUPS: "ro" });
  });

  it("does not shell out when no package is shared", async () => {
    await adapter.prepareSession(
      artifactsWith({
        "@local/alpha": stdioServer("npx", ["-y", "alpha-server@latest"]),
        "@local/beta": stdioServer("npx", ["-y", "beta-server@latest"]),
      }),
      dir,
      { mcpServerOverrides: ["alpha", "beta"] }
    );

    expect(invocations()).toEqual([]);
  });

  it("warms each shared package exactly once", async () => {
    await adapter.prepareSession(
      artifactsWith({
        "@local/a1": stdioServer("npx", ["-y", "alpha@latest"]),
        "@local/a2": stdioServer("npx", ["-y", "alpha@latest"]),
        "@local/a3": stdioServer("npx", ["-y", "alpha@latest"]),
        "@local/b1": stdioServer("npx", ["-y", "beta@latest"]),
        "@local/b2": stdioServer("npx", ["-y", "beta@latest"]),
      }),
      dir,
      { mcpServerOverrides: ["a1", "a2", "a3", "b1", "b2"] }
    );

    expect(invocations()).toEqual([
      "--yes --package alpha@latest --call node --version",
      "--yes --package beta@latest --call node --version",
    ]);
  });

  it("skips unresolved ${VAR} specs rather than installing the placeholder", async () => {
    await adapter.prepareSession(
      artifactsWith({
        "@local/v1": stdioServer("npx", ["-y", "pkg@${PKG_VERSION}"]),
        "@local/v2": stdioServer("npx", ["-y", "pkg@${PKG_VERSION}"]),
      }),
      dir,
      { mcpServerOverrides: ["v1", "v2"] }
    );

    expect(invocations()).toEqual([]);
  });

  it("honors AIR_NPX_PREWARM=0", async () => {
    process.env.AIR_NPX_PREWARM = "0";
    await adapter.prepareSession(
      artifactsWith({
        "@local/a1": stdioServer("npx", ["-y", "alpha@latest"]),
        "@local/a2": stdioServer("npx", ["-y", "alpha@latest"]),
      }),
      dir,
      { mcpServerOverrides: ["a1", "a2"] }
    );

    expect(invocations()).toEqual([]);
  });

  it("honors an explicit prewarmNpxCache: false option", async () => {
    await adapter.prepareSession(
      artifactsWith({
        "@local/a1": stdioServer("npx", ["-y", "alpha@latest"]),
        "@local/a2": stdioServer("npx", ["-y", "alpha@latest"]),
      }),
      dir,
      { mcpServerOverrides: ["a1", "a2"], prewarmNpxCache: false }
    );

    expect(invocations()).toEqual([]);
  });

  it("still writes .mcp.json when the prewarm fails", async () => {
    const shim = join(binDir, "npx");
    writeFileSync(shim, `#!/bin/sh\necho "npm error ENOTFOUND registry" >&2\nexit 1\n`);
    chmodSync(shim, 0o755);

    const result = await adapter.prepareSession(
      artifactsWith({
        "@local/a1": stdioServer("npx", ["-y", "alpha@latest"]),
        "@local/a2": stdioServer("npx", ["-y", "alpha@latest"]),
      }),
      dir,
      { mcpServerOverrides: ["a1", "a2"] }
    );

    expect(result.configFiles).toContain(join(dir, ".mcp.json"));
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
  });
  it("covers a user-authored .mcp.json entry that shares the package", async () => {
    // mergeMcpConfig preserves entries AIR does not manage. One of those
    // sharing an npx spec with an AIR-managed server races it just the same,
    // so the prewarm reads the merged map rather than the AIR-managed subset.
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "hand-written": { command: "npx", args: ["-y", "shared@1.0.0"] },
        },
      })
    );

    await adapter.prepareSession(
      artifactsWith({ "@local/air-managed": stdioServer("npx", ["-y", "shared@1.0.0"]) }),
      dir,
      { mcpServerOverrides: ["air-managed"] }
    );

    expect(invocations()).toEqual(["--yes --package shared@1.0.0 --call node --version"]);
  });

  it("leaves a group alone when a server redirects npm at another registry", async () => {
    await adapter.prepareSession(
      artifactsWith({
        "@local/a1": stdioServer("npx", ["-y", "internal@1.0.0"], {
          NPM_CONFIG_REGISTRY: "https://npm.internal.example",
        }),
        "@local/a2": stdioServer("npx", ["-y", "internal@1.0.0"]),
      }),
      dir,
      { mcpServerOverrides: ["a1", "a2"] }
    );

    expect(invocations()).toEqual([]);
  });
});
