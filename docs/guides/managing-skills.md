# Managing Skills

Skills are reusable, self-contained units of work that agents can invoke during a session. They encode institutional knowledge — how your team deploys, reviews code, handles incidents — into repeatable procedures.

## How skills work

A skill has two parts:

1. **Index entry** in `skills.json` — metadata (ID, description, path, references)
2. **SKILL.md file** in a directory — the actual instructions the agent follows

During session preparation, the adapter copies skill directories into the agent's workspace (e.g., `.claude/skills/` for Claude Code), making them available for the agent to use.

## Defining a skill

### 1. Create the skill directory and SKILL.md

```bash
mkdir -p ~/.air/skills/deploy-staging
```

Create `~/.air/skills/deploy-staging/SKILL.md`:

```markdown
---
name: deploy-staging
title: Deploy to Staging
description: Deploy the current branch to the staging environment
user-invocable: true
---

## Checklist

- [ ] Verify all tests pass on the current branch
- [ ] Build the application
- [ ] Deploy to staging environment
- [ ] Verify the deployment is healthy

## Pre-requisites

- Current branch has a passing CI build
- Staging environment credentials are configured

## Procedure

1. Run the test suite: `npm test`
2. Build the production bundle: `npm run build`
3. Deploy using the staging deploy script: `./scripts/deploy.sh staging`
4. Check the health endpoint: `curl https://staging.example.com/health`

## Output

- Deployment URL
- Health check status
- Any warnings or issues encountered
```

### 2. Add the skill to your index

Edit `~/.air/skills/skills.json`:

```json
{
  "deploy-staging": {
    "id": "deploy-staging",
    "title": "Deploy to Staging",
    "description": "Deploy the current branch to the staging environment for testing",
    "path": "skills/deploy-staging"
  }
}
```

Key fields:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key in the parent object. |
| `description` | Yes | What the skill does. Max 500 characters. |
| `path` | Yes | Relative path to the directory containing SKILL.md. |
| `title` | No | Human-readable display name. Max 100 characters. |
| `references` | No | Array of reference document IDs this skill depends on. |

The `path` is relative to the directory containing the index file (e.g., `skills.json`).

### 3. Validate

```bash
air validate ~/.air/skills/skills.json
```

## SKILL.md format

SKILL.md files use YAML frontmatter followed by Markdown content:

```markdown
---
name: skill-name
title: Human-Readable Title
description: What this skill does
argument-hint: Optional hint for arguments
user-invocable: true
---

## Checklist
...

## Procedure
...
```

### Frontmatter fields

| Field | Description |
|-------|-------------|
| `name` | Skill identifier (should match the index ID) |
| `title` | Display name |
| `description` | Brief description |
| `argument-hint` | Hint text for what arguments the skill accepts |
| `user-invocable` | Whether users can invoke this skill directly (e.g., via `/skill-name`) |

### Recommended sections

- **Checklist** — Step-by-step items the agent should complete. Put this first.
- **Pre-requisites** — What must be true before the skill can run.
- **Input** — What information the skill needs.
- **Procedure** — Detailed instructions for the agent.
- **Output** — What the skill should produce when done.

## Listing skills

See all configured skills:

```bash
air list skills
```

Output:

```
Skills (2):

  deploy-staging (Deploy to Staging)
    Deploy the current branch to the staging environment for testing

  initial-pr-review (Initial PR Review)
    Perform a structured first-pass code review on a pull request
    References: git-workflow, code-standards
```

## Skills with references

Skills can declare dependencies on [reference documents](references.md) to keep knowledge DRY:

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

When the adapter prepares a session, it copies the referenced documents into the skill's directory so the agent has access to them. The reference IDs must match entries defined in your `references.json`.

## How skills get injected into sessions

When you run `air start` or `air prepare`, the adapter:

1. Determines which skills to activate (from root defaults, overrides, or all skills)
2. Copies each skill's directory into the agent workspace (e.g., `.claude/skills/{skill-id}/`)
3. Copies any referenced documents into `references/` within the skill directory
4. Skills already present in the workspace are not overwritten (local takes priority)

### Selecting specific skills

With `air prepare`, you can override which skills are activated:

```bash
air prepare claude --skills deploy-staging,initial-pr-review
```

This activates only the listed skills, ignoring root defaults.

## Best practices

- **Start with a checklist.** Agents follow checklists reliably. Put the most important steps first.
- **Be explicit about inputs and outputs.** Don't assume the agent knows what information is available or what to produce.
- **Keep skills focused.** A skill that does one thing well is more composable than a monolithic skill that tries to handle everything.
- **Use references for shared knowledge.** If multiple skills need the same documentation (coding standards, git workflow), put it in a reference document instead of duplicating it.
- **Set clear stop conditions.** Tell the agent when the skill is done — what constitutes success.
- **Write for autonomous execution.** The agent may run this skill without human supervision. Include error handling and edge case guidance.

## Next steps

- **[References](references.md)** — Share documents across skills without duplication.
- **[Roots and Multi-Root Setups](roots.md)** — Assign default skills to specific roots.
- **[Running Sessions](running-sessions.md)** — See how skills get activated in practice.
