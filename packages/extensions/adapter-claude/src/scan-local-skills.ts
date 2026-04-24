import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { LocalSkillEntry } from "@pulsemcp/air-core";

/**
 * Scan `<targetDir>/.claude/skills/` for user-managed skills and return
 * one entry per directory containing a `SKILL.md`. Missing or unreadable
 * directories yield an empty list — this is a best-effort informational
 * scan, not a validation step.
 */
export function scanLocalSkills(targetDir: string): LocalSkillEntry[] {
  const skillsDir = join(targetDir, ".claude", "skills");
  if (!existsSync(skillsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  const skills: LocalSkillEntry[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;

    const skillDir = join(skillsDir, name);
    let isDir = false;
    try {
      isDir = statSync(skillDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    const frontmatter = readFrontmatter(skillMdPath);
    const description =
      pickString(frontmatter, "description") ?? "(local skill — no description)";
    const title =
      pickString(frontmatter, "title") ?? pickString(frontmatter, "name");

    skills.push({
      id: name,
      description,
      title,
      path: skillDir,
    });
  }

  skills.sort((a, b) => a.id.localeCompare(b.id));
  return skills;
}

/**
 * Minimal YAML frontmatter reader — parses a leading block delimited by
 * `---` lines into a flat key/value map. Only handles top-level
 * `key: value` scalars, which is all SKILL.md frontmatter needs in
 * practice. Unquoted values have surrounding whitespace trimmed and
 * matching single/double quotes stripped.
 */
function readFrontmatter(path: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return {};
  }

  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};

  const result: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") return result;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return {};
}

function pickString(
  obj: Record<string, string>,
  key: string
): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
