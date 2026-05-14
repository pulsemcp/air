import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { resolveArtifacts } from "../src/config.js";
import type { CatalogProvider } from "../src/types.js";
import { createTempAirDir, exampleHook, exampleSkill } from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("provider URI in artifact `path` fields", () => {
  it("resolves a github:// hook path via the registered provider", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        hooks: ["./hooks.json"],
      },
      "hooks.json": {
        "remote-hook": {
          description: "remote hook",
          path: "github://acme/things@v1.2.0/hooks/remote-hook",
        },
      },
      // Pretend the hook directory was already cloned at this location
      "fake-clone/hooks/remote-hook/HOOK.json": JSON.stringify({
        event: "Stop",
      }),
    });
    cleanup = c;

    const calls: string[] = [];
    const provider: CatalogProvider = {
      scheme: "github",
      async resolveCatalogDir(uri: string): Promise<string> {
        calls.push(uri);
        return join(dir, "fake-clone/hooks/remote-hook");
      },
      async resolve(): Promise<Record<string, unknown>> {
        throw new Error("resolve() should not be called for path resolution");
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(calls).toEqual(["github://acme/things@v1.2.0/hooks/remote-hook"]);
    expect(artifacts.hooks["@local/remote-hook"].path).toBe(
      join(dir, "fake-clone/hooks/remote-hook")
    );
  });

  it("resolves a github:// skill path via the registered provider", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "remote-skill": {
          description: "remote skill",
          path: "github://acme/things/skills/remote-skill",
        },
      },
      "remote-skill/SKILL.md": "remote",
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "github",
      async resolveCatalogDir(): Promise<string> {
        return join(dir, "remote-skill");
      },
      async resolve(): Promise<Record<string, unknown>> {
        throw new Error("resolve() should not be called for path resolution");
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.skills["@local/remote-skill"].path).toBe(
      join(dir, "remote-skill")
    );
  });

  it("delegates one provider call per github:// ref/path combination", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        hooks: ["./hooks.json"],
      },
      "hooks.json": {
        "hook-main": {
          description: "main hook",
          path: "github://acme/things@main/hooks/main",
        },
        "hook-v1": {
          description: "v1 hook",
          path: "github://acme/things@v1.0.0/hooks/v1",
        },
        "hook-sha": {
          description: "sha-pinned hook",
          path: "github://acme/things@abc123def456abc123def456abc123def456abcd/hooks/pinned",
        },
      },
    });
    cleanup = c;

    const calls: string[] = [];
    const provider: CatalogProvider = {
      scheme: "github",
      async resolveCatalogDir(uri: string): Promise<string> {
        calls.push(uri);
        return join(dir, "fake-clone");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
    };

    await resolveArtifacts(join(dir, "air.json"), { providers: [provider] });

    expect(calls).toEqual([
      "github://acme/things@main/hooks/main",
      "github://acme/things@v1.0.0/hooks/v1",
      "github://acme/things@abc123def456abc123def456abc123def456abcd/hooks/pinned",
    ]);
  });

  it("throws a clear error when github:// path has no registered provider", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", hooks: ["./hooks.json"] },
      "hooks.json": {
        "remote-hook": {
          description: "remote hook",
          path: "github://acme/things@v1.0.0/hooks/x",
        },
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /No catalog provider registered for scheme "github:\/\/"/
    );
  });

  it("relative path falls through to filesystem resolution unchanged", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", hooks: ["./hooks.json"] },
      "hooks.json": {
        "local-hook": exampleHook("local-hook"),
      },
      "hooks/local-hook/HOOK.json": JSON.stringify({ event: "Stop" }),
    });
    cleanup = c;

    const calls: string[] = [];
    const provider: CatalogProvider = {
      scheme: "github",
      async resolveCatalogDir(uri: string): Promise<string> {
        calls.push(uri);
        return "/should/not/be/used";
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(calls).toEqual([]);
    expect(artifacts.hooks["@local/local-hook"].path).toBe(
      join(dir, "hooks/local-hook")
    );
  });

  it("absolute path is left as-is and provider is not called", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", skills: ["./skills.json"] },
      "skills.json": {
        deploy: exampleSkill("deploy", { path: "/absolute/skills/deploy" }),
      },
    });
    cleanup = c;

    const calls: string[] = [];
    const provider: CatalogProvider = {
      scheme: "github",
      async resolveCatalogDir(uri: string): Promise<string> {
        calls.push(uri);
        return "/should/not/be/used";
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(calls).toEqual([]);
    expect(artifacts.skills["@local/deploy"].path).toBe(
      "/absolute/skills/deploy"
    );
  });
});
