# References

References are shared knowledge documents that can be attached to multiple skills. They exist to keep your configuration DRY — write knowledge once, use it everywhere.

## Why Separate References?

In many teams, the same knowledge is needed by multiple skills. Your git workflow conventions apply to deployment skills, PR review skills, and release skills. Without references, you'd duplicate that knowledge in each skill's documentation.

AIR breaks references out into their own index so:

- **One source of truth** — update a reference once, all skills that use it get the update
- **No drift** — no risk of skills having conflicting versions of the same knowledge
- **Composable** — mix and match references across skills as needed

## Index Format

References are registered in `references.json`:

```json
{
  "git-workflow": {
    "title": "Git Workflow",
    "description": "Standard git workflow, branch naming conventions, and PR processes",
    "path": "references/GIT_WORKFLOW.md"
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | No | Human-readable display name. |
| `description` | Yes | What knowledge this reference contains. |
| `path` | Yes | Relative path to the reference document (typically Markdown). |

## Writing References

References are plain Markdown files. Write them for an audience of AI agents and human reviewers:

```markdown
# Git Workflow

## Branch Naming

All branches follow the pattern: `<type>/<description>`

Types:
- `feature/` — new features
- `fix/` — bug fixes
- `chore/` — maintenance, dependency updates

## PR Process

1. Create branch from `main`
2. Open PR with description and verification section
3. All CI checks must pass
4. At least one approval required
5. Squash merge to `main`

## Commit Messages

Use conventional commits: `type: description`
```

### Tips

- **Include examples** — concrete examples beat abstract descriptions.
- **Scope clearly** — state who this applies to and when. "This applies to all PRs in the web-app repository."
- **Keep them focused** — one topic per reference. If a reference covers git workflow AND deployment, split it.

## Linking References to Skills

Skills declare their reference dependencies in `skills.json`:

```json
{
  "deploy-staging": {
    "description": "Deploy to staging",
    "path": "skills/deploy-staging",
    "references": ["git-workflow", "staging-env"]
  }
}
```

When an agent loads a skill, it also loads all referenced documents. This gives the agent the context it needs to execute the skill correctly.

## Composition

References compose through AIR's scoped layering system. Each catalog (and your local config) contributes references under its own scope — `@acme/air-org/git-workflow`, `@local/git-workflow`, etc. Duplicate qualified IDs hard-fail; cross-scope shortname collisions warn but keep both.

To replace an upstream reference, `exclude` it from the upstream catalog and ship a replacement under your own scope. See [Composition and Overrides](guides/composition-and-overrides.md).
