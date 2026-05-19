# Staging Environment

How the example engineering team's staging environment is structured and how to
access it from a deploy skill.

## Topology

- Each PR gets an isolated namespace named after the branch.
- Namespaces share a single staging database with seeded fixture data.
- Outbound traffic to third-party APIs is mocked at the egress proxy.

## Access

- Web UI: `https://<branch>.staging.example.com`
- SSH: via the staging bastion; engineers must already be in the `staging-access` group.
- Logs: tail with `acme-cli logs staging --branch <branch>`.

## Deployment Targets

- Backend services deploy to the staging Kubernetes cluster.
- Frontend builds deploy to the staging CDN.
- Background jobs run on the staging worker pool.
