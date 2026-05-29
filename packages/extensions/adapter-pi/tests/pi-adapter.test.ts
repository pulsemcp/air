import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { PiAdapter } from "../src/pi-adapter.js";
import { loadManifest } from "@pulsemcp/air-core";
import type { ResolvedArtifacts, RootEntry } from "@pulsemcp/air-core";

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

describe("PiAdapter", () => {
  const adapter = new PiAdapter();

  describe("metadata", () => {
    it("has correct name and displayName", () => {
      expect(adapter.name).toBe("pi");
      expect(adapter.displayName).toBe("Pi");
    });
  });

  describe("generateConfig", () => {
    it("returns activated skill paths and no MCP config", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: "/catalog/skills/deploy",
      };

      const config = adapter.generateConfig(artifacts, {
        description: "Test",
        default_skills: ["deploy"],
      });

      expect(config.agent).toBe("pi");
      expect(config.skillPaths).toEqual(["/catalog/skills/deploy"]);
      expect(config.mcpConfig).toBeUndefined();
    });

    it("merges plugin-declared skills into the activation set", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        description: "Deploy",
        path: "/catalog/skills/deploy",
      };
      artifacts.skills["@local/lint"] = {
        description: "Lint",
        path: "/catalog/skills/lint",
      };
      artifacts.plugins["@local/quality"] = {
        description: "Quality plugin",
        skills: ["@local/lint"],
      };

      const config = adapter.generateConfig(artifacts, {
        description: "Test",
        default_skills: ["deploy"],
        default_plugins: ["quality"],
      });

      expect(config.skillPaths?.sort()).toEqual([
        "/catalog/skills/deploy",
        "/catalog/skills/lint",
      ]);
    });
  });

  describe("buildStartCommand", () => {
    it("runs pi with no extra flags, anchored at the work dir", () => {
      const cmd = adapter.buildStartCommand({
        agent: "pi",
        workDir: "/tmp/session",
        env: { FOO: "bar" },
      });
      expect(cmd.command).toBe("pi");
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
        `air-pi-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(tempDir, { recursive: true });
      return tempDir;
    }

    function writeSkillSrc(dir: string, id: string): string {
      const src = join(dir, "__src__", `src-${id}`, "skills", id);
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}`);
      return resolve(src);
    }

    beforeEach(() => {
      airHomeDir = resolve(
        tmpdir(),
        `air-pi-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

    it("injects skills into .pi/skills/ and returns empty config/hook arrays", async () => {
      const dir = createTempDir();

      const skillSrcDir = join(dir, "__src__", "skills", "deploy");
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

      const skillMd = join(dir, ".pi", "skills", "deploy", "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, "utf-8")).toContain("# Deploy");
      expect(result.skillPaths).toHaveLength(1);
      // Pi discovers skills from the filesystem and has no hooks.
      expect(result.configFiles).toEqual([]);
      expect(result.hookPaths).toEqual([]);
      expect(result.startCommand.command).toBe("pi");
      expect(result.startCommand.cwd).toBe(dir);
    });

    it("copies skill references into a references/ subdir", async () => {
      const dir = createTempDir();

      const skillSrcDir = join(dir, "__src__", "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");

      const refSrcDir = join(dir, "__src__", "references");
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

      await adapter.prepareSession(artifacts, dir, {
        root: { description: "Test", default_skills: ["deploy"] },
      });

      const refPath = join(
        dir,
        ".pi",
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

      const localSkillDir = join(dir, ".pi", "skills", "deploy");
      mkdirSync(localSkillDir, { recursive: true });
      writeFileSync(join(localSkillDir, "SKILL.md"), "# Local Deploy");

      const skillSrcDir = join(dir, "__src__", "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(join(skillSrcDir, "SKILL.md"), "# Catalog Deploy");

      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: resolve(skillSrcDir),
      };

      await adapter.prepareSession(artifacts, dir, {
        root: { description: "Test", default_skills: ["deploy"] },
      });

      expect(
        readFileSync(join(localSkillDir, "SKILL.md"), "utf-8")
      ).toContain("# Local Deploy");
    });

    it("loads no skills when no root is provided", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.skills["@local/deploy"] = {
        description: "Deploy",
        path: writeSkillSrc(dir, "deploy"),
      };

      const result = await adapter.prepareSession(artifacts, dir);

      expect(existsSync(join(dir, ".pi", "skills"))).toBe(false);
      expect(result.skillPaths).toEqual([]);
      expect(result.hookPaths).toEqual([]);
    });

    it("merges subagent-root skills and emits subagent context", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.skills["@local/parent-skill"] = {
        description: "Parent",
        path: writeSkillSrc(dir, "parent-skill"),
      };
      artifacts.skills["@local/sub-skill"] = {
        description: "Sub",
        path: writeSkillSrc(dir, "sub-skill"),
      };
      artifacts.roots["@local/sub"] = {
        description: "Subagent root",
        display_name: "Sub",
        default_skills: ["sub-skill"],
      };

      const result = await adapter.prepareSession(artifacts, dir, {
        root: {
          description: "Parent",
          default_skills: ["parent-skill"],
          default_subagent_roots: ["@local/sub"],
        },
      });

      expect(existsSync(join(dir, ".pi", "skills", "parent-skill"))).toBe(true);
      expect(existsSync(join(dir, ".pi", "skills", "sub-skill"))).toBe(true);
      expect(result.subagentContext).toContain("Subagent Root Dependencies");
      expect(result.subagentContext).toContain("sub-skill");
    });

    describe("activation validation", () => {
      it("throws on an unknown skill ID", async () => {
        const dir = createTempDir();
        await expect(
          adapter.prepareSession(emptyArtifacts(), dir, {
            root: { description: "Test", default_skills: ["nope"] },
          })
        ).rejects.toThrow(/Unknown skill ID "nope"/);
      });

      it("throws on a shortname collision across scopes", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@a/deploy"] = {
          description: "a",
          path: writeSkillSrc(dir, "a-deploy"),
        };
        artifacts.skills["@b/deploy"] = {
          description: "b",
          path: writeSkillSrc(dir, "b-deploy"),
        };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            root: {
              description: "Test",
              default_skills: ["@a/deploy", "@b/deploy"],
            },
          })
        ).rejects.toThrow(/shortname collision/);
      });
    });

    describe("manifest reconciliation", () => {
      it("records activated skills in the manifest with empty hooks/mcp", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["skill-a"] },
        });

        const manifest = loadManifest(dir);
        expect(manifest?.adapter).toBe("pi");
        expect(manifest?.skills).toEqual(["skill-a"]);
        expect(manifest?.hooks).toEqual([]);
        expect(manifest?.mcpServers).toEqual([]);
      });

      it("removes stale skills on re-run", async () => {
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

        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["skill-a", "skill-b"],
          },
        });
        expect(existsSync(join(dir, ".pi", "skills", "skill-b"))).toBe(true);

        // Second run drops skill-b.
        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["skill-a"] },
        });

        expect(existsSync(join(dir, ".pi", "skills", "skill-a"))).toBe(true);
        expect(existsSync(join(dir, ".pi", "skills", "skill-b"))).toBe(false);

        const manifest = loadManifest(dir);
        expect(manifest?.skills).toEqual(["skill-a"]);
      });

      it("skips a skill whose source directory is missing and warns", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/ghost"] = {
          description: "Ghost",
          path: resolve(dir, "__src__", "does-not-exist"),
        };

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          await adapter.prepareSession(artifacts, dir, {
            root: { description: "Test", default_skills: ["ghost"] },
          });
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toContain("does not exist");
        } finally {
          warn.mockRestore();
        }

        // The skill was skipped, so the manifest does not claim ownership of it.
        expect(existsSync(join(dir, ".pi", "skills", "ghost"))).toBe(false);
        const manifest = loadManifest(dir);
        expect(manifest?.skills).toEqual([]);
      });
    });

    describe("cleanSession", () => {
      it("removes AIR-managed skills and deletes the manifest", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/deploy"] = {
          description: "Deploy",
          path: writeSkillSrc(dir, "deploy"),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["deploy"] },
        });

        const result = await adapter.cleanSession(dir);

        expect(result.removedSkills).toEqual(["deploy"]);
        expect(result.removedHooks).toEqual([]);
        expect(result.removedMcpServers).toEqual([]);
        expect(result.mcpConfigPath).toBeNull();
        expect(result.settingsPath).toBeNull();
        expect(result.manifestRemoved).toBe(true);
        expect(existsSync(join(dir, ".pi", "skills", "deploy"))).toBe(false);
      });

      it("keeps skills and rewrites the manifest with keepSkills", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/deploy"] = {
          description: "Deploy",
          path: writeSkillSrc(dir, "deploy"),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["deploy"] },
        });

        const result = await adapter.cleanSession(dir, { keepSkills: true });

        expect(result.removedSkills).toEqual([]);
        expect(result.manifestRemoved).toBe(false);
        expect(existsSync(join(dir, ".pi", "skills", "deploy"))).toBe(true);

        const manifest = loadManifest(dir);
        expect(manifest?.skills).toEqual(["deploy"]);
      });

      it("reports what would be removed in dry-run without touching disk", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["@local/deploy"] = {
          description: "Deploy",
          path: writeSkillSrc(dir, "deploy"),
        };

        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["deploy"] },
        });

        const result = await adapter.cleanSession(dir, { dryRun: true });

        expect(result.removedSkills).toEqual(["deploy"]);
        expect(result.manifestRemoved).toBe(true); // would be removed
        // Nothing actually deleted.
        expect(existsSync(join(dir, ".pi", "skills", "deploy"))).toBe(true);
        expect(loadManifest(dir)?.skills).toEqual(["deploy"]);
      });

      it("returns an empty result when there is no manifest", async () => {
        const dir = createTempDir();
        const result = await adapter.cleanSession(dir);
        expect(result.removedSkills).toEqual([]);
        expect(result.removedHooks).toEqual([]);
        expect(result.removedMcpServers).toEqual([]);
        expect(result.manifestExisted).toBe(false);
      });
    });
  });

  describe("listLocalArtifacts", () => {
    it("surfaces skills checked into .pi/skills/", async () => {
      const dir = resolve(
        tmpdir(),
        `air-pi-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(join(dir, ".pi", "skills", "local-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(dir, ".pi", "skills", "local-skill", "SKILL.md"),
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
