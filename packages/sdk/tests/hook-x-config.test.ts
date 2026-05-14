import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { prepareSession } from "../src/prepare.js";
import { resolveFullArtifacts } from "../src/resolve.js";

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
    `air-sdk-hook-xconfig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("hook x-config materialization", () => {
  describe("resolveFullArtifacts", () => {
    it("merges consumer x-config into source HOOK.json x-config", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          hooks: ["./hooks.json"],
        },
        "hooks.json": {
          "tagged-hook": {
            description: "tagged hook",
            path: "hooks/tagged-hook",
            "x-config": {
              tags: ["consumer-a"],
              defaults: { greeting: "hi" },
            },
          },
        },
        "hooks/tagged-hook/HOOK.json": JSON.stringify({
          event: "Stop",
          "x-config": {
            defaults: { greeting: "hello", farewell: "bye" },
            owner: "source",
          },
        }),
      });

      const artifacts = await resolveFullArtifacts({
        config: join(catalog, "air.json"),
      });

      const hook = artifacts.hooks["@local/tagged-hook"];
      expect(hook["x-config"]).toEqual({
        // tags is from consumer (replaced source absent)
        tags: ["consumer-a"],
        // greeting overridden by consumer; farewell preserved from source
        defaults: { greeting: "hi", farewell: "bye" },
        // owner kept from source (absent on consumer)
        owner: "source",
      });
    });

    it("returns consumer x-config alone when source HOOK.json has none", async () => {
      const catalog = createTemp({
        "air.json": { name: "test", hooks: ["./hooks.json"] },
        "hooks.json": {
          "consumer-only": {
            description: "consumer only",
            path: "hooks/consumer-only",
            "x-config": { foo: "bar" },
          },
        },
        "hooks/consumer-only/HOOK.json": JSON.stringify({ event: "Stop" }),
      });

      const artifacts = await resolveFullArtifacts({
        config: join(catalog, "air.json"),
      });
      expect(artifacts.hooks["@local/consumer-only"]["x-config"]).toEqual({
        foo: "bar",
      });
    });

    it("returns source x-config alone when consumer has none", async () => {
      const catalog = createTemp({
        "air.json": { name: "test", hooks: ["./hooks.json"] },
        "hooks.json": {
          "source-only": {
            description: "source only",
            path: "hooks/source-only",
          },
        },
        "hooks/source-only/HOOK.json": JSON.stringify({
          event: "Stop",
          "x-config": { greeting: "hello" },
        }),
      });

      const artifacts = await resolveFullArtifacts({
        config: join(catalog, "air.json"),
      });
      expect(artifacts.hooks["@local/source-only"]["x-config"]).toEqual({
        greeting: "hello",
      });
    });

    it("omits x-config field when neither side has one", async () => {
      const catalog = createTemp({
        "air.json": { name: "test", hooks: ["./hooks.json"] },
        "hooks.json": {
          "no-config": {
            description: "no config",
            path: "hooks/no-config",
          },
        },
        "hooks/no-config/HOOK.json": JSON.stringify({ event: "Stop" }),
      });

      const artifacts = await resolveFullArtifacts({
        config: join(catalog, "air.json"),
      });
      expect("x-config" in artifacts.hooks["@local/no-config"]).toBe(false);
    });

    it("consumer overlay arrays replace source arrays (no concatenation)", async () => {
      const catalog = createTemp({
        "air.json": { name: "test", hooks: ["./hooks.json"] },
        "hooks.json": {
          "arr-hook": {
            description: "arr hook",
            path: "hooks/arr-hook",
            "x-config": { tags: ["only-this"] },
          },
        },
        "hooks/arr-hook/HOOK.json": JSON.stringify({
          event: "Stop",
          "x-config": { tags: ["a", "b", "c"] },
        }),
      });

      const artifacts = await resolveFullArtifacts({
        config: join(catalog, "air.json"),
      });
      expect(artifacts.hooks["@local/arr-hook"]["x-config"]).toEqual({
        tags: ["only-this"],
      });
    });

    it("preserves consumer x-config when source HOOK.json is missing", async () => {
      const catalog = createTemp({
        "air.json": { name: "test", hooks: ["./hooks.json"] },
        "hooks.json": {
          "no-source": {
            description: "no source HOOK.json",
            path: "hooks/no-source",
            "x-config": { foo: "bar" },
          },
        },
      });

      const artifacts = await resolveFullArtifacts({
        config: join(catalog, "air.json"),
      });
      expect(artifacts.hooks["@local/no-source"]["x-config"]).toEqual({
        foo: "bar",
      });
    });
  });

  describe("prepareSession writes merged x-config to HOOK.json", () => {
    it("writes consumer-merged x-config back into materialized HOOK.json", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          hooks: ["./hooks.json"],
          roots: ["./roots.json"],
        },
        "hooks.json": {
          "merge-hook": {
            description: "merge hook",
            path: "hooks/merge-hook",
            "x-config": {
              defaults: { greeting: "hi" },
              tags: ["c"],
            },
          },
        },
        "hooks/merge-hook/HOOK.json": JSON.stringify({
          event: "Stop",
          command: "node",
          "x-config": {
            defaults: { greeting: "hello", farewell: "bye" },
            tags: ["a", "b"],
            owner: "src",
          },
        }),
        "roots.json": {
          default: {
            description: "Default",
            default_hooks: ["merge-hook"],
          },
        },
      });

      const target = createTemp({});

      await prepareSession({
        config: join(catalog, "air.json"),
        adapter: "claude",
        root: "default",
        target,
      });

      const hookJson = JSON.parse(
        readFileSync(
          join(target, ".claude", "hooks", "merge-hook", "HOOK.json"),
          "utf-8"
        )
      );

      expect(hookJson.event).toBe("Stop");
      expect(hookJson.command).toBe("node");
      expect(hookJson["x-config"]).toEqual({
        defaults: { greeting: "hi", farewell: "bye" },
        tags: ["c"],
        owner: "src",
      });
    });

    it("leaves source x-config untouched when consumer has no x-config", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          hooks: ["./hooks.json"],
          roots: ["./roots.json"],
        },
        "hooks.json": {
          "passthrough-hook": {
            description: "passthrough",
            path: "hooks/passthrough-hook",
          },
        },
        "hooks/passthrough-hook/HOOK.json": JSON.stringify({
          event: "Stop",
          command: "node",
          "x-config": { greeting: "hello" },
        }),
        "roots.json": {
          default: {
            description: "Default",
            default_hooks: ["passthrough-hook"],
          },
        },
      });

      const target = createTemp({});

      await prepareSession({
        config: join(catalog, "air.json"),
        adapter: "claude",
        root: "default",
        target,
      });

      const hookJson = JSON.parse(
        readFileSync(
          join(target, ".claude", "hooks", "passthrough-hook", "HOOK.json"),
          "utf-8"
        )
      );
      expect(hookJson["x-config"]).toEqual({ greeting: "hello" });
    });

    it("resolves ${VAR} interpolation inside x-config via secrets-env", async () => {
      const savedVal = process.env.SDK_TEST_XCONFIG_SECRET;
      process.env.SDK_TEST_XCONFIG_SECRET = "interpolated-value";

      try {
        const catalog = createTemp({
          "air.json": {
            name: "test",
            extensions: ["@pulsemcp/air-secrets-env"],
            hooks: ["./hooks.json"],
            roots: ["./roots.json"],
          },
          "hooks.json": {
            "interp-hook": {
              description: "interp hook",
              path: "hooks/interp-hook",
              "x-config": {
                credentials: { token: "${SDK_TEST_XCONFIG_SECRET}" },
              },
            },
          },
          "hooks/interp-hook/HOOK.json": JSON.stringify({
            event: "Stop",
            command: "node",
            "x-config": { credentials: { user: "alice" } },
          }),
          "roots.json": {
            default: {
              description: "Default",
              default_hooks: ["interp-hook"],
            },
          },
        });

        const target = createTemp({});

        await prepareSession({
          config: join(catalog, "air.json"),
          adapter: "claude",
          root: "default",
          target,
        });

        const hookJson = JSON.parse(
          readFileSync(
            join(target, ".claude", "hooks", "interp-hook", "HOOK.json"),
            "utf-8"
          )
        );
        expect(hookJson["x-config"]).toEqual({
          credentials: { user: "alice", token: "interpolated-value" },
        });
      } finally {
        if (savedVal === undefined) {
          delete process.env.SDK_TEST_XCONFIG_SECRET;
        } else {
          process.env.SDK_TEST_XCONFIG_SECRET = savedVal;
        }
      }
    });
  });
});
