import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanLocalSkills } from "../src/scan-local-skills.js";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `air-pi-scan-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("scanLocalSkills (pi)", () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const dir of cleanup) {
      rmSync(dir, { recursive: true, force: true });
    }
    cleanup.length = 0;
  });

  it("returns empty list when .pi/skills does not exist", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    expect(scanLocalSkills(dir)).toEqual([]);
  });

  it("returns empty list when the target directory does not exist", () => {
    expect(
      scanLocalSkills(join(tmpdir(), `air-pi-nonexistent-${Date.now()}`))
    ).toEqual([]);
  });

  it("discovers each subdirectory that contains SKILL.md", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "alpha"), { recursive: true });
    mkdirSync(join(skillsDir, "beta"), { recursive: true });
    writeFileSync(
      join(skillsDir, "alpha", "SKILL.md"),
      "---\ndescription: Alpha skill\n---\nbody"
    );
    writeFileSync(
      join(skillsDir, "beta", "SKILL.md"),
      "---\ndescription: Beta skill\n---\nbody"
    );

    const result = scanLocalSkills(dir);
    expect(result.map((s) => s.id)).toEqual(["alpha", "beta"]);
    expect(result[0].description).toBe("Alpha skill");
    expect(result[1].description).toBe("Beta skill");
    expect(result[0].path).toBe(join(skillsDir, "alpha"));
  });

  it("skips directories that do not contain a SKILL.md", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "with-md"), { recursive: true });
    mkdirSync(join(skillsDir, "without-md"), { recursive: true });
    writeFileSync(
      join(skillsDir, "with-md", "SKILL.md"),
      "---\ndescription: Present\n---\nbody"
    );

    const result = scanLocalSkills(dir);
    expect(result.map((s) => s.id)).toEqual(["with-md"]);
  });

  it("skips dotfiles in .pi/skills/", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, ".hidden"), { recursive: true });
    writeFileSync(
      join(skillsDir, ".hidden", "SKILL.md"),
      "---\ndescription: Hidden\n---\n"
    );

    expect(scanLocalSkills(dir)).toEqual([]);
  });

  it("falls back to a placeholder description when frontmatter is missing", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "no-meta"), { recursive: true });
    writeFileSync(
      join(skillsDir, "no-meta", "SKILL.md"),
      "no frontmatter at all"
    );

    const result = scanLocalSkills(dir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("no-meta");
    expect(result[0].description).toBe("(local skill — no description)");
  });

  it("reads frontmatter from a well-formed block followed by a multi-line body", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "trailing"), { recursive: true });
    // Closing `---` on its own line, then a heading and more body text.
    writeFileSync(
      join(skillsDir, "trailing", "SKILL.md"),
      "---\ndescription: Trailing body\n---\n# Heading\nmore text"
    );

    const result = scanLocalSkills(dir);
    expect(result[0].description).toBe("Trailing body");
  });

  it("reads frontmatter even when the closing delimiter is missing entirely", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "unclosed"), { recursive: true });
    // No closing `---`: the reader consumes every line after the opener and
    // returns what it parsed rather than discarding the whole block.
    writeFileSync(
      join(skillsDir, "unclosed", "SKILL.md"),
      "---\ntitle: Unclosed Title\ndescription: Unclosed\nno closing delimiter"
    );

    const result = scanLocalSkills(dir);
    expect(result[0].description).toBe("Unclosed");
    expect(result[0].title).toBe("Unclosed Title");
  });

  it("strips matching quotes from frontmatter values", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "quoted"), { recursive: true });
    writeFileSync(
      join(skillsDir, "quoted", "SKILL.md"),
      `---\ndescription: "A quoted description"\ntitle: 'Quoted Title'\n---\n`
    );

    const result = scanLocalSkills(dir);
    expect(result[0].description).toBe("A quoted description");
    expect(result[0].title).toBe("Quoted Title");
  });

  it("uses the name field as the title when title is absent", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    mkdirSync(join(skillsDir, "named"), { recursive: true });
    writeFileSync(
      join(skillsDir, "named", "SKILL.md"),
      "---\nname: Deploy\ndescription: Deploys things\n---\n"
    );

    const result = scanLocalSkills(dir);
    expect(result[0].title).toBe("Deploy");
  });

  it("sorts results alphabetically by id", () => {
    const dir = createTempDir();
    cleanup.push(dir);
    const skillsDir = join(dir, ".pi", "skills");
    for (const id of ["zulu", "alpha", "mike"]) {
      mkdirSync(join(skillsDir, id), { recursive: true });
      writeFileSync(
        join(skillsDir, id, "SKILL.md"),
        "---\ndescription: x\n---\n"
      );
    }

    const result = scanLocalSkills(dir);
    expect(result.map((s) => s.id)).toEqual(["alpha", "mike", "zulu"]);
  });
});
