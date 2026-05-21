#!/usr/bin/env bash
#
# check-no-tracked-claude.sh
#
# Fails if any file under .claude/ is tracked by git.
#
# .claude/ is the Claude adapter's conventional working directory. In this repo
# it is gitignored (see .gitignore "Agent session files") and populated at
# runtime by the Claude adapter / Agent Orchestrator. Hand-authored skills,
# MCP configs, and hooks must NOT be committed there — doing so requires
# `git add -f` to bypass .gitignore, and the committed copy is shadowed by the
# adapter-injected one at session time, so it silently does nothing.
#
# The air-* development skills are sourced from the central agent catalog and
# injected at session start — edit them at their source, not here. Any genuinely
# repo-local skill/MCP/hook belongs in an in-repo AIR catalog (a skills.json /
# air.json), never under .claude/. See docs/guides/managing-skills-in-your-repo.md.
#
# Deterministic and fast: a single `git ls-files` with no heuristics.

set -euo pipefail

# Resolve repo root so the check works from any directory.
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tracked="$(git ls-files .claude/)"

if [ -n "$tracked" ]; then
  echo "ERROR: Files under .claude/ are tracked by git:" >&2
  echo >&2
  echo "$tracked" | sed 's/^/  - /' >&2
  echo >&2
  echo ".claude/ is adapter-owned and gitignored in this repo, so these files" >&2
  echo "were almost certainly force-added with 'git add -f'. The Claude adapter /" >&2
  echo "Agent Orchestrator overwrites .claude/ at session start, so a committed" >&2
  echo "copy is shadowed and silently has no effect." >&2
  echo >&2
  echo "The air-* development skills are sourced from the central agent catalog" >&2
  echo "and injected at session start — edit them at their source, not here." >&2
  echo "Any genuinely repo-local skill/MCP/hook belongs in an in-repo AIR catalog" >&2
  echo "(a skills.json / air.json), never under .claude/." >&2
  echo >&2
  echo "Then untrack the .claude/ copies:" >&2
  echo "  git rm --cached <file>" >&2
  echo >&2
  echo "See docs/guides/managing-skills-in-your-repo.md for the authoring surface." >&2
  exit 1
fi

echo "OK: no tracked files under .claude/"
