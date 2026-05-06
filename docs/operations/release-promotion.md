# Release Promotion

> このページでわかること: dev -> staging -> production の sign-off gate、
> product root ごとの所有境界、production promotion に必要な証跡。

| Field | Value |
| --- | --- |
| Last reviewed | 2026-05-07 |
| Owner | Release owner / product owners |
| Scope | Takos managed release promotion |

## Boundary

Takos の primary customer surface は Web / API です。Production promotion は
Takos Web / API (`takos/app`)、Takos Git hosting (`takos/git`)、Takos agent
service (`takos/agent`)、Takos product shell (`takos/`) の customer-facing
impact を基準に判定します。

Takosumi / takosumi-git / takos-cli は generic または CLI product として別
release できますが、Takos managed service に取り込む場合はこの sign-off gate
を通します。Production deploy credential、secret、live cloud operation は
`takos-private/` が正本です。

## Promotion Flow

| Stage | Trigger | Required gate | Owner | Output |
| --- | --- | --- | --- | --- |
| Development | local branch / draft PR | relevant product check / test / lint | author | clean local diff or draft evidence |
| Pull request | PR opened against protected branch | root PR Check + product-specific CI | reviewer | reviewed PR, green required checks |
| Merge | approved PR merged to `master` / `main` | branch protection required checks | maintainer | immutable merge commit |
| Staging | merge or release-candidate tag | release gate + staging deploy dry-run / deploy | release owner + operator | staging URL, release manifest, smoke evidence |
| Observation | staging is healthy | observation window and rollback readiness | on-call owner | metrics / logs / incident-free note |
| Production | manual approval only | release sign-off checklist | release owner + operator | production deployment id, announcement, rollback plan |

Production promotion must not be fully automatic before GA. A human release
owner confirms the release checklist, and the operator executes the production
deploy from `takos-private/`.

## Required Sign-off Evidence

Before production:

- merged commit SHA and branch / tag
- release gate JSON summary from `deno task release-gate`
- release artifact manifest from `scripts/build-release-manifest.ts`
- staging deploy id or Cloudflare / Helm / Terraform run evidence
- smoke test result for Takos Web / API login, billing-safe route, Git hosting,
  and agent execution path when affected
- docs build result when docs, legal, operations, or public API shape changed
- migration safety evidence for `takos/app` DB migrations
- Terraform plan summary for infrastructure changes
- rollback plan and previous healthy deployment id
- release announcement draft using `/operations/release-announcement-template`

Block production if any required evidence is missing, stale, or points to a
different commit SHA than the release candidate.

## Product Root Matrix

| Product root | Required local gate | Promotion owner | Production deploy path |
| --- | --- | --- | --- |
| `takos/` | `deno task release-gate` | Takos release owner | `takos-private/` |
| `takos/app/` | `deno task check`, `deno task test`, web build when UI changes | Takos app owner | `takos-private/apps/control` |
| `takos/git/` | `deno task check`, `deno task test` | Takos Git hosting owner | `takos-private/` |
| `takos/agent/` | `cargo test`, `cargo test --features mock-llm` | Takos agent owner | `takos-private/` |
| `takosumi/` | `deno task check`, `deno task test`, `deno task publish:dry-run` | Takosumi owner | JSR / image release, then Takos intake |
| `takosumi-git/` | `deno task check`, `deno task test` | takosumi-git owner | JSR release, then Takos intake |
| `takos-cli/` | `deno task check`, `deno task test`, `deno task compile` | Takos CLI owner | CLI release |
| `takos-private/` | `deno task verify`, `deno task lint`, `deno task build:all` | operator | live staging / production deploy |

## Branch Protection

Every public product repo must protect the release branch (`master` or `main`)
with:

- required PR review before merge
- required status checks matching the product root matrix
- stale review dismissal when code changes
- no direct pushes except emergency maintainer break-glass
- linear history or merge policy chosen per repo and documented
- administrator bypass disabled for normal releases

Branch protection export evidence is private / GitHub-side evidence. It is a GA
readiness artifact and must be refreshed when required check names change.

## Release Freeze Rules

Freeze production promotion when:

- a SEV-1 / SEV-2 incident is open
- rollback target is unknown or image / artifact retention is insufficient
- migration safety markers are missing
- legal / privacy / security disclosure docs are affected and not reviewed
- a required submodule points to a dirty or uncommitted state
- release announcement lacks changelog, breaking change assessment, migration
  guide, or rollback plan

Emergency security releases may bypass the normal observation window only when
the incident commander records the reason and the rollback / forward-fix plan.
