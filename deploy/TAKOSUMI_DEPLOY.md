# Deploying Takos via Takosumi

## Overview

Takos can be deployed through the Takosumi Installer API instead of direct wrangler/helm commands. This enables unified
deployment tracking, rollback, and audit through Takosumi's Installation/Deployment model.

## Current Status

Phase 5 groundwork complete — NOT YET VALIDATED.

Deploy script and GitHub Actions workflow have been created, but no staging or production validation has been performed.
Continue to use existing wrangler/helm deploy until the migration path below is completed.

### Known Limitations

- No staging validation has been performed against a live Takosumi Installer API.
- The deploy script (`scripts/takosumi-deploy.sh`) is untested against a live Installer endpoint.
- GitHub Actions workflow (`takosumi-deploy.yml`) has not been triggered in a real CI environment.

### Next Steps

1. Run `--dry-run` against the staging Installer API and verify the response.
2. Deploy to staging via the Takosumi script alongside the existing wrangler deploy.
3. Compare Takosumi-managed Deployment record with wrangler deploy output.
4. Switch staging to Takosumi-only deploy and monitor for one release cycle.
5. Repeat steps 1–4 for production.

## Usage

### Local

```bash
export TAKOSUMI_INSTALLER_URL=http://localhost:8788
export TAKOSUMI_INSTALLER_TOKEN=dev-installer-token
export TAKOSUMI_SPACE_ID=space_takos
./scripts/takosumi-deploy.sh --dry-run
```

### CI

The `takosumi-deploy.yml` workflow runs on `workflow_dispatch`. Required secrets: TAKOSUMI_INSTALLER_URL,
TAKOSUMI_INSTALLER_TOKEN, TAKOSUMI_SPACE_ID, TAKOSUMI_INSTALLATION_ID.

## Migration Path

1. Validate dry-run in staging
2. Run actual deploy in staging alongside existing wrangler deploy
3. Compare results
4. Switch staging to Takosumi-only deploy
5. Repeat for production
