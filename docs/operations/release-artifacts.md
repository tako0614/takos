# Release Artifact Pipelines

> このページでわかること: semver tag から JSR package、OCI image、Helm chart を
> build / publish する所有境界と gate。

| Field         | Value                              |
| ------------- | ---------------------------------- |
| Last reviewed | 2026-05-07                         |
| Owner         | Release owner / product owners     |
| Scope         | Takos / Takosumi release artifacts |

## Artifact Matrix

| Artifact                  | Owning repo     | Workflow                                  | Trigger      | Publish target                                          |
| ------------------------- | --------------- | ----------------------------------------- | ------------ | ------------------------------------------------------- |
| Takosumi JSR packages     | `takosumi/`     | `.github/workflows/release.yml`           | `v*.*.*` tag | JSR `@takos/takosumi-*`                                 |
| Takosumi OCI image        | `takosumi/`     | `.github/workflows/release.yml`           | `v*.*.*` tag | `ghcr.io/<owner>/takosumi:<version>`                    |
| takosumi-git JSR packages | `takosumi-git/` | `.github/workflows/release.yml`           | `v*.*.*` tag | JSR `@takos/takosumi-git-*`                             |
| Takos service OCI images  | `takos/`        | `.github/workflows/release-artifacts.yml` | `v*.*.*` tag | `ghcr.io/<owner>/takos-app`, `takos-git`, `takos-agent` |
| Takos Helm chart          | `takos/`        | `.github/workflows/release-artifacts.yml` | `v*.*.*` tag | `oci://ghcr.io/<owner>/charts/takos`                    |

Tag names are semver tags with a leading `v`, for example `v1.2.3`. Manual
`workflow_dispatch` runs are dry-run by default; publishing from a manual run
requires the explicit `publish` input.

## Required Gates

Before any publish step:

- JSR pipelines run `deno task check`, `deno task test`, and
  `deno task publish:dry-run`.
- Takos OCI / Helm pipeline runs `deno task check`,
  `deno task validate:release-promotion`, `deno task validate:helm`,
  `deno task helm:check-overlays`, and `deno task helm:template-smoke`.
- Helm chart versions are derived from the semver tag without the leading `v`.
- OCI images are tagged with the semver version and immutable `sha-*` tag.
- JSR publish uses GitHub OIDC (`id-token: write`) and does not require a long
  lived registry token.

## Takos Boundary

Takos customer-facing Web / API remains the primary surface. The Takos product
release pipeline builds only the service images and Helm chart required by the
Takos distribution:

- `takos-app` from `deploy/docker/takos-app.Dockerfile`
- `takos-git` from `git/Dockerfile`
- `takos-agent` from `agent/Dockerfile`

`takosumi` and `takosumi-git` publish their generic CLI / kernel artifacts from
their own repositories. Takos release promotion consumes those published
artifacts; it does not move CLI ownership into the Takos product shell.

## Release Evidence

Attach these artifacts to the release sign-off record:

- tag name, commit SHA, and workflow run URL
- JSR dry-run and publish log for each package set
- OCI image digest for every service image
- Helm chart digest and chart version
- release gate JSON summary
- rollback target image digest / chart version
