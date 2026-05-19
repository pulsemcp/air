# Git Workflow

Standard git workflow used by the example engineering team.

## Branch Naming

- Feature branches: `feature/<ticket-id>-<short-description>`
- Bug fixes: `fix/<ticket-id>-<short-description>`
- Hotfixes: `hotfix/<short-description>`

## Pull Request Process

1. Branch from `main`.
2. Push changes and open a PR with a description and a link to the ticket.
3. Request at least one approving review.
4. Wait for CI to pass.
5. Squash and merge.
