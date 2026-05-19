---
name: initial-pr-review
description: Perform a structured first-pass code review on a pull request
---

# Initial PR Review

A structured first pass over a pull request: identify what changed, surface the
load-bearing decisions, and call out anything that needs to change before a
deeper review.

## Steps

1. Read the PR description and linked ticket; restate the goal in your own words.
2. Skim the diff top-to-bottom; note the files that look load-bearing.
3. For each load-bearing file, read it in full and trace the new behaviour.
4. Cross-check against the team's code standards (see references).
5. Leave inline comments grouped by severity: blocker, suggestion, nit.
