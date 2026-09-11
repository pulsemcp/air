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
import { ClaudeAdapter } from "../src/claude-adapter.js";
import {
  MANIFEST_VERSION,
  loadManifest,
  writeManifest,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";

// pulsemcp/air#168: a skill directory AIR did not create must never be
// recorded in the manifest, because everything in the manifest is deleted
// once it is deselected.

const SKILLS_DIR = ".claude/skills";
const USER_CONTENT = "# My own foo, with uncommitted edits\n";

const adapter = new ClaudeAdapter();

let base: string;
let target: string;
let originalAirHome: string | undefined;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "air-claude-ownership-"));
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

function skillDir(id: string): string {
  return join(target, SKILLS_DIR, id);
}

/**
 * A catalog with `foo` (which the user also has checked in, in most tests)
 * and `bar`, which has a nested file and a reference so AIR's copy of it is
 * more than a lone SKILL.md.
 */
function catalog(): ResolvedArtifacts {
  const src = join(base, "catalog");
  write(join(src, "skills", "foo", "SKILL.md"), "# Catalog foo\n");
  write(join(src, "skills", "bar", "SKILL.md"), "# Catalog bar\n");
  write(join(src, "skills", "bar", "scripts", "run.sh"), "echo bar\n");
  write(join(src, "references", "GUIDE.md"), "# Guide\n");
  return {
    skills: {
      "@local/foo": { description: "Foo", path: join(src, "skills", "foo") },
      "@local/bar": {
        description: "Bar",
        path: join(src, "skills", "bar"),
        references: ["@local/guide"],
      },
    },
    references: {
      "@local/guide": {
        description: "Guide",
        path: join(src, "references", "GUIDE.md"),
      },
    },
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
  };
}

function writeUserSkill(id: string): void {
  write(join(skillDir(id), "SKILL.md"), USER_CONTENT);
}

function userSkillContent(id: string): string | null {
  const path = join(skillDir(id), "SKILL.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

function select(artifacts: ResolvedArtifacts, skills: string[]) {
  return adapter.prepareSession(artifacts, target, { skillOverrides: skills });
}

function manifestSkills(): string[] | undefined {
  return loadManifest(target)?.skills;
}

/** Rewrite the manifest the way an AIR version before the fix wrote it. */
function rewriteAsVersion1(skills: string[]): void {
  const manifest = loadManifest(target);
  if (!manifest) throw new Error("expected a manifest to rewrite");
  writeManifest({ ...manifest, version: 1, skills });
}

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

function warnedAbout(warn: ReturnType<typeof silenceWarnings>, id: string): boolean {
  return warn.mock.calls.some((args) =>
    String(args[0]).includes(`${SKILLS_DIR}/${id}`)
  );
}

describe("ClaudeAdapter skill ownership (#168)", () => {
  describe("prepareSession", () => {
    it("never claims a pre-existing skill directory, so deselecting it leaves the user's files alone", async () => {
      const artifacts = catalog();
      writeUserSkill("foo");

      await select(artifacts, ["foo", "bar"]);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
      expect(manifestSkills()).toEqual(["bar"]);
      expect(loadManifest(target)?.version).toBe(MANIFEST_VERSION);
      expect(MANIFEST_VERSION).toBe(2);

      await select(artifacts, []);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
      // The directory AIR did create is still cleaned up.
      expect(existsSync(skillDir("bar"))).toBe(false);
      expect(manifestSkills()).toEqual([]);
    });

    it("keeps owning a directory it created on later runs, even after the user edits it", async () => {
      const artifacts = catalog();

      await select(artifacts, ["bar"]);
      write(join(skillDir("bar"), "SKILL.md"), "# Edited in place\n");
      await select(artifacts, ["bar"]);
      expect(manifestSkills()).toEqual(["bar"]);

      await select(artifacts, []);
      expect(existsSync(skillDir("bar"))).toBe(false);
    });

    it("installs and owns the catalog skill once the user removes their own directory", async () => {
      const artifacts = catalog();
      writeUserSkill("foo");
      await select(artifacts, ["foo"]);
      expect(manifestSkills()).toEqual([]);

      rmSync(skillDir("foo"), { recursive: true, force: true });
      await select(artifacts, ["foo"]);
      expect(readFileSync(join(skillDir("foo"), "SKILL.md"), "utf-8")).toBe(
        "# Catalog foo\n"
      );
      expect(manifestSkills()).toEqual(["foo"]);

      await select(artifacts, []);
      expect(existsSync(skillDir("foo"))).toBe(false);
    });
  });

  describe("a version 1 manifest (written before the fix)", () => {
    it("gives up an entry whose files differ from the catalog skill instead of deleting it when it is deselected", async () => {
      const artifacts = catalog();
      writeUserSkill("foo");
      await select(artifacts, ["foo", "bar"]);
      // What the buggy version recorded: the user's foo as AIR's.
      rewriteAsVersion1(["foo", "bar"]);
      const warn = silenceWarnings();

      await select(artifacts, ["bar"]);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
      expect(warnedAbout(warn, "foo")).toBe(true);
      expect(loadManifest(target)?.version).toBe(2);
      expect(manifestSkills()).toEqual(["bar"]);

      await select(artifacts, []);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
      expect(existsSync(skillDir("bar"))).toBe(false);
    });

    it("gives it up when it stays selected too, so a later deselect can't delete it", async () => {
      const artifacts = catalog();
      writeUserSkill("foo");
      await select(artifacts, ["foo", "bar"]);
      rewriteAsVersion1(["foo", "bar"]);
      silenceWarnings();

      await select(artifacts, ["foo", "bar"]);
      expect(manifestSkills()).toEqual(["bar"]);

      await select(artifacts, []);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
    });

    it("keeps owning an entry whose files are exactly what AIR installs, references included", async () => {
      const artifacts = catalog();
      await select(artifacts, ["foo", "bar"]);
      rewriteAsVersion1(["foo", "bar"]);
      const warn = silenceWarnings();

      // bar stays selected and is still AIR's; foo is deselected and removed.
      await select(artifacts, ["bar"]);
      expect(existsSync(skillDir("foo"))).toBe(false);
      expect(manifestSkills()).toEqual(["bar"]);
      expect(warn).not.toHaveBeenCalled();

      await select(artifacts, []);
      expect(existsSync(skillDir("bar"))).toBe(false);
    });

    it("gives up an AIR copy that no longer matches the catalog, leaving it in place", async () => {
      const artifacts = catalog();
      await select(artifacts, ["bar"]);
      // Can't be told apart from a user's skill: edited, or the catalog moved on.
      write(join(skillDir("bar"), "NOTES.md"), "my notes\n");
      rewriteAsVersion1(["bar"]);
      const warn = silenceWarnings();

      await select(artifacts, []);
      expect(readFileSync(join(skillDir("bar"), "NOTES.md"), "utf-8")).toBe(
        "my notes\n"
      );
      expect(warnedAbout(warn, "bar")).toBe(true);
      expect(manifestSkills()).toEqual([]);
    });
  });

  describe("cleanSession", () => {
    it("leaves a version 1 manifest's skills in place and keeps them for prepareSession to check", async () => {
      const artifacts = catalog();
      writeUserSkill("foo");
      await select(artifacts, ["foo", "bar"]);
      rewriteAsVersion1(["foo", "bar"]);
      const warn = silenceWarnings();

      const result = await adapter.cleanSession(target);
      expect(result.removedSkills).toEqual([]);
      expect(result.manifestRemoved).toBe(false);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
      expect(existsSync(skillDir("bar"))).toBe(true);
      expect(warnedAbout(warn, "foo")).toBe(true);
      expect(loadManifest(target)).toMatchObject({
        version: 1,
        skills: ["foo", "bar"],
      });

      // One prepareSession sorts them out; the next clean removes only AIR's.
      await select(artifacts, ["foo", "bar"]);
      const second = await adapter.cleanSession(target);
      expect(second.removedSkills).toEqual(["bar"]);
      expect(second.manifestRemoved).toBe(true);
      expect(existsSync(skillDir("bar"))).toBe(false);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
    });

    it("keeps a version 1 manifest at version 1 when skills are kept", async () => {
      const artifacts = catalog();
      await select(artifacts, ["bar"]);
      rewriteAsVersion1(["bar"]);

      await adapter.cleanSession(target, { keepSkills: true });
      expect(loadManifest(target)).toMatchObject({ version: 1, skills: ["bar"] });
    });

    it("removes a version 2 manifest's skills but never a directory it didn't create", async () => {
      const artifacts = catalog();
      writeUserSkill("foo");
      await select(artifacts, ["foo", "bar"]);

      const result = await adapter.cleanSession(target);
      expect(result.removedSkills).toEqual(["bar"]);
      expect(result.manifestRemoved).toBe(true);
      expect(existsSync(skillDir("bar"))).toBe(false);
      expect(userSkillContent("foo")).toBe(USER_CONTENT);
    });
  });
});
