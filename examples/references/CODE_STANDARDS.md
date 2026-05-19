# Code Standards

Engineering-wide code standards used in code reviews.

## Style

- Prefer explicit over clever — name things so the next reader doesn't have to guess.
- Functions do one thing; if you can't summarize it in one sentence, split it.
- Avoid premature abstraction. Three similar lines beat the wrong helper.

## Comments

- Default to no comment. Add one only when the WHY is non-obvious.
- Don't restate WHAT the code does; identifiers should already do that.
- Don't reference the current ticket — that belongs in the PR description.

## Tests

- Every public function has at least one happy-path test.
- Every bug fix lands with a regression test.
- Prefer table-driven tests when the same logic runs against many inputs.
