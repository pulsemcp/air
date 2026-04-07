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
import { findUnresolvedVars } from "../src/validate-config.js";

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
    `air-sdk-prepare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("prepareSession", () => {
  it("writes .mcp.json to target directory", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
          env: { TOKEN: "abc" },
        },
      },
    });

    const target = createTemp({});

    const result = await prepareSession({
      config: join(catalog, "air.json"),
      target,
    });

    const mcpJsonPath = join(target, ".mcp.json");
    expect(existsSync(mcpJsonPath)).toBe(true);

    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(mcpJson.mcpServers.github).toBeDefined();
    expect(mcpJson.mcpServers.github.command).toBe("npx");
    expect(mcpJson.mcpServers.github.env.TOKEN).toBe("abc");

    expect(result.session.configFiles).toContain(mcpJsonPath);
  });

  it("injects skills from catalog into target", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "A test skill",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# My Skill\nDo the thing.",
    });

    const target = createTemp({});

    const result = await prepareSession({
      config: join(catalog, "air.json"),
      target,
    });

    const skillMd = join(target, ".claude", "skills", "my-skill", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    expect(readFileSync(skillMd, "utf-8")).toContain("My Skill");

    expect(result.session.skillPaths).toContain(
      join(target, ".claude", "skills", "my-skill")
    );
  });

  it("filters artifacts by root defaults", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["github-mcp"] },
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
        postgres: { type: "stdio", command: "npx", args: ["pg-mcp"] },
      },
      "roots.json": {
        "web-app": {
          name: "web-app",
          description: "Web app root",
          default_mcp_servers: ["github", "postgres"],
        },
      },
    });

    const target = createTemp({});

    await prepareSession({
      config: join(catalog, "air.json"),
      root: "web-app",
      target,
    });

    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.github).toBeDefined();
    expect(mcpJson.mcpServers.postgres).toBeDefined();
    expect(mcpJson.mcpServers.slack).toBeUndefined();
  });

  it("supports skill overrides", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": {
          id: "skill-a",
          description: "Skill A",
          path: "skills/skill-a",
        },
        "skill-b": {
          id: "skill-b",
          description: "Skill B",
          path: "skills/skill-b",
        },
        "skill-c": {
          id: "skill-c",
          description: "Skill C",
          path: "skills/skill-c",
        },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "skills/skill-c/SKILL.md": "# C",
      "roots.json": {
        myroot: {
          name: "myroot",
          description: "Test root",
          default_skills: ["skill-a", "skill-b"],
        },
      },
    });

    const target = createTemp({});

    await prepareSession({
      config: join(catalog, "air.json"),
      root: "myroot",
      skills: ["skill-c"],
      target,
    });

    expect(
      existsSync(join(target, ".claude", "skills", "skill-c", "SKILL.md"))
    ).toBe(true);
    expect(
      existsSync(join(target, ".claude", "skills", "skill-a"))
    ).toBe(false);
  });

  it("supports mcp-servers overrides", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["github-mcp"] },
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
      },
      "roots.json": {
        myroot: {
          name: "myroot",
          description: "Test",
          default_mcp_servers: ["github"],
        },
      },
    });

    const target = createTemp({});

    await prepareSession({
      config: join(catalog, "air.json"),
      root: "myroot",
      mcpServers: ["slack"],
      target,
    });

    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.slack).toBeDefined();
    expect(mcpJson.mcpServers.github).toBeUndefined();
  });

  it("throws with unknown adapter", async () => {
    const catalog = createTemp({
      "air.json": { name: "test" },
    });

    await expect(
      prepareSession({
        config: join(catalog, "air.json"),
        adapter: "nonexistent",
      })
    ).rejects.toThrow("No adapter found");
  });

  it("throws with missing air.json", async () => {
    await expect(
      prepareSession({ config: "/nonexistent/air.json" })
    ).rejects.toThrow();
  });

  it("throws with unknown root", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        roots: ["./roots.json"],
      },
      "roots.json": {},
    });

    await expect(
      prepareSession({
        config: join(catalog, "air.json"),
        root: "nonexistent",
      })
    ).rejects.toThrow("not found");
  });

  describe("extensions and transforms", () => {
    it("runs a local transform that modifies .mcp.json", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["./add-marker.js"],
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: { type: "stdio", command: "npx", env: { KEY: "value" } },
        },
        // Local transform that adds a marker env var
        "add-marker.js": `
export default async function(config, context) {
  for (const entry of Object.values(config.mcpServers)) {
    if (entry.env) {
      entry.env.TRANSFORMED = "true";
    }
  }
  return config;
}
`,
      });

      const target = createTemp({});

      await prepareSession({
        config: join(catalog, "air.json"),
        target,
      });

      const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
      expect(mcpJson.mcpServers.server.env.KEY).toBe("value");
      expect(mcpJson.mcpServers.server.env.TRANSFORMED).toBe("true");
    });

    it("runs transforms in declaration order", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["./first.js", "./second.js"],
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: { type: "stdio", command: "npx", env: { ORDER: "" } },
        },
        "first.js": `
export default async function(config, context) {
  for (const entry of Object.values(config.mcpServers)) {
    if (entry.env) entry.env.ORDER = (entry.env.ORDER || "") + "first";
  }
  return config;
}
`,
        "second.js": `
export default async function(config, context) {
  for (const entry of Object.values(config.mcpServers)) {
    if (entry.env) entry.env.ORDER = (entry.env.ORDER || "") + ",second";
  }
  return config;
}
`,
      });

      const target = createTemp({});

      await prepareSession({
        config: join(catalog, "air.json"),
        target,
      });

      const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
      expect(mcpJson.mcpServers.server.env.ORDER).toBe("first,second");
    });

    it("works without extensions array (backward compat)", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: { type: "stdio", command: "npx", env: { TOKEN: "abc" } },
        },
      });

      const target = createTemp({});

      await prepareSession({
        config: join(catalog, "air.json"),
        target,
      });

      const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
      expect(mcpJson.mcpServers.server.command).toBe("npx");
      expect(mcpJson.mcpServers.server.env.TOKEN).toBe("abc");
    });

    it("resolves ${VAR} from process.env via secrets-env extension", async () => {
      const savedVal = process.env.SDK_TEST_SECRET;
      process.env.SDK_TEST_SECRET = "resolved-from-env";

      try {
        const catalog = createTemp({
          "air.json": {
            name: "test",
            extensions: ["@pulsemcp/air-secrets-env"],
            mcp: ["./mcp.json"],
          },
          "mcp.json": {
            server: {
              type: "stdio",
              command: "npx",
              env: { API_KEY: "${SDK_TEST_SECRET}" },
            },
          },
        });

        const target = createTemp({});

        await prepareSession({
          config: join(catalog, "air.json"),
          target,
        });

        const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers.server.env.API_KEY).toBe("resolved-from-env");
      } finally {
        if (savedVal === undefined) {
          delete process.env.SDK_TEST_SECRET;
        } else {
          process.env.SDK_TEST_SECRET = savedVal;
        }
      }
    });

    it("resolves ${VAR} from secrets file via secrets-file extension", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["@pulsemcp/air-secrets-file"],
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "stdio",
            command: "npx",
            env: { API_KEY: "${FILE_SECRET}" },
          },
        },
        "secrets.json": { FILE_SECRET: "resolved-from-file" },
      });

      const target = createTemp({});

      await prepareSession({
        config: join(catalog, "air.json"),
        target,
        extensionOptions: { "secrets-file": join(catalog, "secrets.json") },
      });

      const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
      expect(mcpJson.mcpServers.server.env.API_KEY).toBe("resolved-from-file");
    });

    it("chains multiple secret transforms (file first, env fallback)", async () => {
      const savedVal = process.env.SDK_TEST_FALLBACK;
      process.env.SDK_TEST_FALLBACK = "from-env";

      try {
        const catalog = createTemp({
          "air.json": {
            name: "test",
            extensions: [
              "@pulsemcp/air-secrets-file",
              "@pulsemcp/air-secrets-env",
            ],
            mcp: ["./mcp.json"],
          },
          "mcp.json": {
            server: {
              type: "stdio",
              command: "npx",
              env: {
                FROM_FILE: "${FILE_KEY}",
                FROM_ENV: "${SDK_TEST_FALLBACK}",
              },
            },
          },
          "secrets.json": { FILE_KEY: "from-file" },
        });

        const target = createTemp({});

        await prepareSession({
          config: join(catalog, "air.json"),
          target,
          extensionOptions: { "secrets-file": join(catalog, "secrets.json") },
        });

        const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers.server.env.FROM_FILE).toBe("from-file");
        expect(mcpJson.mcpServers.server.env.FROM_ENV).toBe("from-env");
      } finally {
        if (savedVal === undefined) {
          delete process.env.SDK_TEST_FALLBACK;
        } else {
          process.env.SDK_TEST_FALLBACK = savedVal;
        }
      }
    });

    it("throws with invalid extension specifier", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["@nonexistent/air-extension-12345"],
        },
      });

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target: createTemp({}),
        })
      ).rejects.toThrow("Failed to load extension");
    });
  });

  describe("unresolved variable validation", () => {
    it("passes when all variables are resolved", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "stdio",
            command: "npx",
            env: { TOKEN: "resolved-value" },
          },
        },
      });

      const target = createTemp({});

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target,
        })
      ).resolves.toBeDefined();
    });

    it("throws when unresolved ${VAR} patterns remain", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "stdio",
            command: "npx",
            env: { TOKEN: "${MISSING_SECRET}" },
          },
        },
      });

      const target = createTemp({});

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target,
        })
      ).rejects.toThrow("Unresolved variable");
    });

    it("lists all unresolved variables in the error", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "stdio",
            command: "npx",
            env: { A: "${MISSING_A}", B: "${MISSING_B}" },
          },
        },
      });

      const target = createTemp({});

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target,
        })
      ).rejects.toThrow(/\$\{MISSING_A\}.*\$\{MISSING_B\}/);
    });

    it("checks nested values in MCP server config", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "sse",
            url: "https://example.com",
            headers: {
              Authorization: "Bearer ${NESTED_SECRET}",
            },
          },
        },
      });

      const target = createTemp({});

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target,
        })
      ).rejects.toThrow("NESTED_SECRET");
    });

    it("checks values inside arrays", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "stdio",
            command: "npx",
            args: ["--token", "${ARRAY_SECRET}"],
          },
        },
      });

      const target = createTemp({});

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target,
        })
      ).rejects.toThrow("ARRAY_SECRET");
    });

    it("skips validation when skipValidation is true", async () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          server: {
            type: "stdio",
            command: "npx",
            env: { TOKEN: "${UNRESOLVED}" },
          },
        },
      });

      const target = createTemp({});

      await expect(
        prepareSession({
          config: join(catalog, "air.json"),
          target,
          skipValidation: true,
        })
      ).resolves.toBeDefined();
    });

    it("validates after transforms have run", async () => {
      const savedVal = process.env.SDK_TEST_VALIDATED;
      process.env.SDK_TEST_VALIDATED = "resolved";

      try {
        const catalog = createTemp({
          "air.json": {
            name: "test",
            extensions: ["@pulsemcp/air-secrets-env"],
            mcp: ["./mcp.json"],
          },
          "mcp.json": {
            server: {
              type: "stdio",
              command: "npx",
              env: { RESOLVED: "${SDK_TEST_VALIDATED}", MISSING: "${NOT_SET_VAR_12345}" },
            },
          },
        });

        const target = createTemp({});

        // Should fail because NOT_SET_VAR_12345 is not in env
        await expect(
          prepareSession({
            config: join(catalog, "air.json"),
            target,
          })
        ).rejects.toThrow("NOT_SET_VAR_12345");
      } finally {
        if (savedVal === undefined) {
          delete process.env.SDK_TEST_VALIDATED;
        } else {
          process.env.SDK_TEST_VALIDATED = savedVal;
        }
      }
    });
  });

  describe("findUnresolvedVars", () => {
    it("returns empty array when no vars present", () => {
      expect(
        findUnresolvedVars({ mcpServers: { s: { command: "npx" } } })
      ).toEqual([]);
    });

    it("finds vars in flat values", () => {
      expect(
        findUnresolvedVars({
          mcpServers: { s: { env: { KEY: "${SECRET}" } } },
        })
      ).toEqual(["SECRET"]);
    });

    it("finds vars in nested objects", () => {
      expect(
        findUnresolvedVars({
          mcpServers: {
            s: { headers: { auth: "Bearer ${TOKEN}" } },
          },
        })
      ).toEqual(["TOKEN"]);
    });

    it("finds vars in arrays", () => {
      expect(
        findUnresolvedVars({
          mcpServers: { s: { args: ["--key", "${ARG_VAR}"] } },
        })
      ).toEqual(["ARG_VAR"]);
    });

    it("deduplicates repeated vars", () => {
      const result = findUnresolvedVars({
        mcpServers: {
          a: { env: { X: "${SAME}" } },
          b: { env: { Y: "${SAME}" } },
        },
      });
      expect(result).toEqual(["SAME"]);
    });

    it("finds multiple vars in one string", () => {
      const result = findUnresolvedVars({
        mcpServers: {
          s: { url: "https://${HOST}:${PORT}/api" },
        },
      });
      expect(result).toContain("HOST");
      expect(result).toContain("PORT");
      expect(result).toHaveLength(2);
    });
  });
});
