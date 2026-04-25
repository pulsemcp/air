# References

References are shared knowledge documents — Markdown files that provide context to skills without duplicating content. When multiple skills need the same documentation (coding standards, git workflow, API specs), references keep things DRY.

## Why references exist

Without references, you'd copy the same documentation into every skill that needs it. When the documentation changes, you'd need to update every copy. References solve this by defining shared documents once and linking them to skills by ID.

## Defining references

Add entries to `~/.air/references/references.json`:

```json
{
  "git-workflow": {
    "id": "git-workflow",
    "title": "Git Workflow",
    "description": "Standard git workflow, branch naming conventions, and PR processes",
    "file": "references/GIT_WORKFLOW.md"
  },
  "code-standards": {
    "id": "code-standards",
    "title": "Code Standards",
    "description": "Coding standards and conventions for the engineering team",
    "file": "references/CODE_STANDARDS.md"
  }
}
```

### Reference fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `description` | Yes | What knowledge this reference contains. Max 500 characters. |
| `file` | Yes | Relative path to the Markdown file. |
| `title` | No | Human-readable name. Max 100 characters. |

The `file` path is relative to the directory containing the index file (e.g., `references.json`).

## Writing reference documents

Create the Markdown file at the path specified in `file`:

```bash
mkdir -p ~/.air/references
```

`~/.air/references/GIT_WORKFLOW.md`:

```markdown
# Git Workflow

## Branch naming

- Feature branches: `feature/description`
- Bug fixes: `fix/description`
- Releases: `release/vX.Y.Z`

## Pull request process

1. Create a branch from `main`
2. Make changes and commit with descriptive messages
3. Open a PR with a clear title and description
4. Get at least one approval
5. Squash merge to `main`

## Commit messages

Use conventional commits:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `refactor:` for refactoring
```

## Linking references to skills

Skills declare their reference dependencies in the skills index:

```json
{
  "initial-pr-review": {
    "id": "initial-pr-review",
    "title": "Initial PR Review",
    "description": "Perform a structured first-pass code review on a pull request",
    "path": "skills/initial-pr-review",
    "references": ["git-workflow", "code-standards"]
  }
}
```

The `references` array contains IDs that must match entries in your `references.json`.

## How references get injected

During session preparation, the adapter:

1. Reads the skill's `references` array
2. Looks up each reference ID in the resolved artifacts
3. Copies the reference file into the skill's directory (e.g., `.claude/skills/{skill-id}/references/`)

This gives the agent access to the reference content alongside the skill's SKILL.md.

## Listing references

```bash
air list references
```

Output:

```
References (2):

  git-workflow (Git Workflow)
    Standard git workflow, branch naming conventions, and PR processes
    File: references/GIT_WORKFLOW.md

  code-standards (Code Standards)
    Coding standards and conventions for the engineering team
    File: references/CODE_STANDARDS.md
```

## Composition

References follow the same scoped composition semantics as all AIR artifacts. If you have multiple reference index files or catalogs:

```json
{
  "catalogs": [
    "github://acme/air-org",
    "github://acme/air-frontend"
  ],
  "references": ["./references/local-references.json"]
}
```

Each entry contributes references under its own scope (`@acme/air-org/...`, `@acme/air-frontend/...`, `@local/...`). Duplicate qualified IDs hard-fail. To replace an upstream reference, `exclude` it and ship a replacement under your own scope.

## Best practices

- **Write clear, focused documents.** Each reference should cover one topic well. Don't combine unrelated information.
- **Include examples.** Agents work better with concrete examples of expected patterns.
- **Scope descriptions clearly.** The `description` field helps agents (and humans) understand what the reference covers without reading the full document.
- **Keep references general.** References should contain knowledge that applies across multiple skills. Skill-specific details belong in SKILL.md.
- **Use Markdown.** Reference files are typically Markdown for readability by both humans and agents.

## Next steps

- **[Managing Skills](managing-skills.md)** — Link references to skills.
- **[Composition and Overrides](composition-and-overrides.md)** — Layer org-level references with team-level additions and exclusions.
- **[Validating Configuration](validating-configuration.md)** — Validate your references index.
