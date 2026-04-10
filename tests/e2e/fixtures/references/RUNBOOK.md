# Incident Runbook

## Severity Levels

- **SEV1**: Complete service outage — all hands on deck
- **SEV2**: Degraded service — primary on-call responds
- **SEV3**: Minor issue — next business day

## Escalation

1. Page the on-call engineer
2. If no response in 10 minutes, page the backup
3. If SEV1, start a war room in #incidents

## Rollback

```bash
git revert <commit> && git push origin main
```

Trigger the deployment pipeline to roll back to the previous version.
