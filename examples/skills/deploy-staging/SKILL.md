---
name: deploy-staging
description: Deploy the current PR branch to the staging environment for testing
---

# Deploy to Staging

Deploy the current PR branch to the staging environment so other engineers and
reviewers can exercise it before merge.

## Steps

1. Confirm the PR branch is up to date with `main`.
2. Run the pre-deploy checks documented in the `staging-env` reference.
3. Trigger the staging deployment pipeline for the PR's branch.
4. Watch the smoke tests; surface any failures in the PR.
5. Post the staging URL back to the PR for reviewers.
