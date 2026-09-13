import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { CodexAdapter } from "../src/codex-adapter.js";
import {
  MANIFEST_VERSION,
  buildManifest,
  loadManifest,
  writeManifest,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";

// pulsemcp/air#174: an MCP server key AIR did not write must never be
// overwritten or recorded in the manifest, because every key in the manifest
// is removed once it is deselected.

const CONFIG_FILE = ".codex/config.toml";
const USER_SERVER = { command: "USER-OWN" };

const adapter = new CodexAdapter();

let base: string;
let target: string;
let originalAirHome: string | undefined;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "air-codex-mcp-ownership-"));
  target = join(base, "target");
  mkdirSync(target, { recursive: true });
  originalAirHome = process.env.AIR_HOME;
  process.env.AIR_HOME = join(base, "air-home");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
  if (originalAirHome === undefined) {
    delete process.env.AIR_HOME;
  } else {
    process.env.AIR_HOME = originalAirHome;
  }
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// --- adapter-specific config access ---

function readConfig(): Record<string, unknown> | null {
  const path = join(target, CONFIG_FILE);
  return existsSync(path)
    ? (parseToml(readFileSync(path, "utf-8")) as Record<string, unknown>)
    : null;
}

function writeConfig(config: Record<string, unknown>): void {
  write(join(target, CONFIG_FILE), stringifyToml(config));
}

function servers(): Record<string, Record<string, unknown>> {
  return (readConfig()?.mcp_servers ?? {}) as Record<string, Record<string, unknown>>;
}

function setServers(next: Record<string, unknown>): void {
  writeConfig({ ...(readConfig() ?? {}), mcp_servers: next });
}

// --- shared ---

/**
 * A catalog with `github` (which the user also has in their config, in most
 * tests) and `slack`, whose secret reference makes AIR's entry for it more
 * than a bare command.
 */
function catalog(): ResolvedArtifacts {
  return {
    skills: {},
    references: {},
    mcp: {
      "@local/github": { type: "stdio", command: "gh-mcp" },
      "@local/slack": {
        type: "stdio",
        command: "slack-mcp",
        env: { SLACK_TOKEN: "${SLACK_TOKEN}" },
      },
    },
    plugins: {},
    roots: {},
    hooks: {},
  };
}

function writeUserServer(id: string): void {
  setServers({ ...servers(), [id]: USER_SERVER });
}

function editServer(id: string, patch: Record<string, unknown>): void {
  setServers({ ...servers(), [id]: { ...servers()[id], ...patch } });
}

function removeServer(id: string): void {
  const next = { ...servers() };
  delete next[id];
  setServers(next);
}

function select(artifacts: ResolvedArtifacts, mcp: string[]) {
  return adapter.prepareSession(artifacts, target, { mcpServerOverrides: mcp });
}

function manifestServers(): string[] | undefined {
  return loadManifest(target)?.mcpServers;
}

/** Rewrite the manifest the way an AIR version before the fix wrote it. */
function rewriteAsLegacy(version: number, mcpServers: string[]): void {
  const manifest = loadManifest(target);
  if (!manifest) throw new Error("expected a manifest to rewrite");
  writeManifest({ ...manifest, version, mcpServers });
}

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

function warnedAbout(warn: ReturnType<typeof silenceWarnings>, id: string): boolean {
  return warn.mock.calls.some((args) => {
    const message = String(args[0]);
    return message.includes(CONFIG_FILE) && message.includes(`"${id}"`);
  });
}

describe("CodexAdapter MCP server ownership (#174)", () => {
  describe("prepareSession", () => {
    it("never overwrites or claims a user's key that shares a catalog server's shortname, so deselecting it leaves the entry alone", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      const warn = silenceWarnings();

      await select(artifacts, ["github", "slack"]);
      expect(servers().github).toEqual(USER_SERVER);
      expect(servers().slack).toMatchObject({ command: "slack-mcp" });
      expect(manifestServers()).toEqual(["slack"]);
      expect(loadManifest(target)?.version).toBe(MANIFEST_VERSION);
      expect(MANIFEST_VERSION).toBe(3);
      // The user is told why the selected server isn't there.
      expect(warnedAbout(warn, "github")).toBe(true);

      await select(artifacts, []);
      expect(servers().github).toEqual(USER_SERVER);
      // The key AIR did write is still cleaned up.
      expect(servers().slack).toBeUndefined();
      expect(manifestServers()).toEqual([]);
    });

    it("keeps owning a key it wrote on later runs, rewriting it, and removes it once deselected", async () => {
      const artifacts = catalog();

      await select(artifacts, ["github"]);
      expect(manifestServers()).toEqual(["github"]);
      editServer("github", { command: "edited-in-place" });
      await select(artifacts, ["github"]);
      expect(servers().github).toMatchObject({ command: "gh-mcp" });
      expect(manifestServers()).toEqual(["github"]);

      await select(artifacts, []);
      expect(servers().github).toBeUndefined();
      expect(manifestServers()).toEqual([]);
    });

    it("writes and owns the catalog server once the user removes their own key", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      silenceWarnings();
      await select(artifacts, ["github"]);
      expect(manifestServers()).toEqual([]);

      removeServer("github");
      await select(artifacts, ["github"]);
      expect(servers().github).toMatchObject({ command: "gh-mcp" });
      expect(manifestServers()).toEqual(["github"]);

      await select(artifacts, []);
      expect(servers().github).toBeUndefined();
    });

    it("ignores a manifest another adapter wrote, whose entries name that adapter's config", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      silenceWarnings();
      writeManifest(
        buildManifest(target, { adapter: "another-adapter", mcpServers: ["github"] })
      );

      // Deselected: not a cleanup candidate here.
      await select(artifacts, []);
      expect(servers().github).toEqual(USER_SERVER);

      writeManifest(
        buildManifest(target, { adapter: "another-adapter", mcpServers: ["github"] })
      );
      // Selected: not overwritten or re-claimed either.
      await select(artifacts, ["github"]);
      expect(servers().github).toEqual(USER_SERVER);
      expect(manifestServers()).toEqual([]);
      await select(artifacts, []);
      expect(servers().github).toEqual(USER_SERVER);
    });
  });

  // Every manifest written before the fix could list a user's key, whatever
  // its version: version 2 only vouches for skills.
  describe.each([1, 2])("a version %i manifest (written before the fix)", (version) => {
    it("gives up a key whose config differs from the catalog server instead of removing it when it is deselected", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      await select(artifacts, ["slack"]);
      // What the buggy version recorded: the user's github as AIR's.
      rewriteAsLegacy(version, ["github", "slack"]);
      const warn = silenceWarnings();

      await select(artifacts, ["slack"]);
      expect(servers().github).toEqual(USER_SERVER);
      expect(warnedAbout(warn, "github")).toBe(true);
      expect(warnedAbout(warn, "slack")).toBe(false);
      expect(loadManifest(target)?.version).toBe(MANIFEST_VERSION);
      expect(manifestServers()).toEqual(["slack"]);

      await select(artifacts, []);
      expect(servers().github).toEqual(USER_SERVER);
      expect(servers().slack).toBeUndefined();
    });

    it("gives it up when it stays selected too, without overwriting it, so a later deselect can't remove it", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      await select(artifacts, ["slack"]);
      rewriteAsLegacy(version, ["github", "slack"]);
      silenceWarnings();

      await select(artifacts, ["github", "slack"]);
      expect(servers().github).toEqual(USER_SERVER);
      expect(manifestServers()).toEqual(["slack"]);

      await select(artifacts, []);
      expect(servers().github).toEqual(USER_SERVER);
    });

    it("keeps owning keys whose config is exactly what AIR writes, secret references included", async () => {
      const artifacts = catalog();
      await select(artifacts, ["github", "slack"]);
      rewriteAsLegacy(version, ["github", "slack"]);
      const warn = silenceWarnings();

      // slack stays selected and is still AIR's; github is deselected and removed.
      await select(artifacts, ["slack"]);
      expect(servers().github).toBeUndefined();
      expect(manifestServers()).toEqual(["slack"]);
      expect(warn).not.toHaveBeenCalled();

      await select(artifacts, []);
      expect(servers().slack).toBeUndefined();
    });

    it("gives up a key AIR wrote that has since been edited, leaving it in place", async () => {
      const artifacts = catalog();
      await select(artifacts, ["github"]);
      // Can't be told apart from a user's entry: edited, or the catalog moved on.
      editServer("github", { args: ["--mine"] });
      rewriteAsLegacy(version, ["github"]);
      const warn = silenceWarnings();

      await select(artifacts, []);
      expect(servers().github).toMatchObject({ command: "gh-mcp", args: ["--mine"] });
      expect(warnedAbout(warn, "github")).toBe(true);
      expect(manifestServers()).toEqual([]);
    });

    it("writes and owns an entry whose key is gone", async () => {
      const artifacts = catalog();
      await select(artifacts, ["github"]);
      removeServer("github");
      rewriteAsLegacy(version, ["github"]);

      await select(artifacts, ["github"]);
      expect(servers().github).toMatchObject({ command: "gh-mcp" });
      expect(manifestServers()).toEqual(["github"]);
    });
  });

  describe("cleanSession", () => {
    it("leaves an earlier manifest's MCP keys in place and keeps them for prepareSession to check", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      await select(artifacts, ["slack"]);
      rewriteAsLegacy(2, ["github", "slack"]);
      const warn = silenceWarnings();

      const result = await adapter.cleanSession(target);
      expect(result.removedMcpServers).toEqual([]);
      expect(result.manifestRemoved).toBe(false);
      expect(servers().github).toEqual(USER_SERVER);
      expect(servers().slack).toBeDefined();
      expect(warnedAbout(warn, "github")).toBe(true);
      expect(loadManifest(target)).toMatchObject({
        version: 2,
        mcpServers: ["github", "slack"],
      });

      // One prepareSession sorts them out; the next clean removes only AIR's.
      await select(artifacts, ["github", "slack"]);
      const second = await adapter.cleanSession(target);
      expect(second.removedMcpServers).toEqual(["slack"]);
      expect(second.manifestRemoved).toBe(true);
      expect(servers().slack).toBeUndefined();
      expect(servers().github).toEqual(USER_SERVER);
    });

    it("changes nothing on a dry run over an earlier manifest", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      await select(artifacts, ["slack"]);
      rewriteAsLegacy(1, ["github", "slack"]);
      silenceWarnings();

      const result = await adapter.cleanSession(target, { dryRun: true });
      expect(result.removedMcpServers).toEqual([]);
      expect(result.manifestRemoved).toBe(false);
      expect(servers().github).toEqual(USER_SERVER);
      expect(servers().slack).toBeDefined();
      expect(loadManifest(target)).toMatchObject({
        version: 1,
        mcpServers: ["github", "slack"],
      });
    });

    it("keeps an earlier manifest at its version when MCP servers are kept", async () => {
      const artifacts = catalog();
      await select(artifacts, ["slack"]);
      rewriteAsLegacy(2, ["slack"]);

      await adapter.cleanSession(target, { keepMcpServers: true });
      expect(loadManifest(target)).toMatchObject({ version: 2, mcpServers: ["slack"] });
    });

    it("removes a current manifest's MCP keys but never a key it didn't write", async () => {
      const artifacts = catalog();
      writeUserServer("github");
      silenceWarnings();
      await select(artifacts, ["github", "slack"]);

      const result = await adapter.cleanSession(target);
      expect(result.removedMcpServers).toEqual(["slack"]);
      expect(result.manifestRemoved).toBe(true);
      expect(servers().slack).toBeUndefined();
      expect(servers().github).toEqual(USER_SERVER);
    });
  });
});
