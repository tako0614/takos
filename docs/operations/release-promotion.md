# Release Promotion

> このページでわかること: dev -> staging -> production の sign-off gate、
> product root ごとの所有境界、production promotion に必要な証跡。

| Field         | Value                           |
| ------------- | ------------------------------- |
| Last reviewed | 2026-05-07                      |
| Owner         | Release owner / product owners  |
| Scope         | Takos managed release promotion |

## Boundary

Installable App Model における release は **2 layer** に分かれます。

1. **Takosumi infrastructure release** — Takosumi kernel / Takosumi Accounts /
   takosumi-git / takosumi-cloud の generic PaaS substrate。OIDC issuer、
   AppInstallation ledger、deploy engine、billing が含まれます。Takos は
   このレイヤの owner ではなく、**install される側の app** です。
2. **Takos app release** — `takos.chat` Installable App としての app shell
   (`takos/`) と内部 service (`takos/app`、`takos/git`、`takos/agent`) の
   release。Git URL + ref + commit / `appManifestDigest` を bump し、
   AppInstallation lifecycle (install / upgrade / rollback / materialize /
   export) と integrate します。

Takos の primary customer surface は Web / API です。Production promotion は
Takos app layer の Web / API (`takos/app`)、Takos Git hosting (`takos/git`)、
Takos agent service (`takos/agent`)、Takos product shell (`takos/`) の
customer-facing impact を基準に判定します。

Takosumi infra layer (Takosumi kernel / Takosumi Accounts / takosumi-git /
takos-cli) は generic または CLI product として別 release できますが、Takos
managed installation に取り込む場合はこの sign-off gate を通します。 Production
deploy credential、secret、live cloud operation は `takos-private/` が正本です。

## Promotion Flow

| Stage        | Trigger                                 | Required gate                                  | Owner                    | Output                                                |
| ------------ | --------------------------------------- | ---------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| Development  | local branch / draft PR                 | relevant product check / test / lint           | author                   | clean local diff or draft evidence                    |
| Pull request | PR opened against protected branch      | root PR Check + product-specific CI            | reviewer                 | reviewed PR, green required checks                    |
| Merge        | approved PR merged to `master` / `main` | branch protection required checks              | maintainer               | immutable merge commit                                |
| Staging      | merge or release-candidate tag          | release gate + staging deploy dry-run / deploy | release owner + operator | staging URL, release manifest, smoke evidence         |
| Observation  | staging is healthy                      | observation window and rollback readiness      | on-call owner            | metrics / logs / incident-free note                   |
| Production   | manual approval only                    | release sign-off checklist                     | release owner + operator | production deployment id, announcement, rollback plan |

Production promotion must not be fully automatic before GA. A human release
owner confirms the release checklist, and the operator executes the production
deploy from `takos-private/`.

## Required Sign-off Evidence

Before production:

- merged commit SHA and branch / tag
- release gate JSON summary from `deno task release-gate`
- release artifact manifest from `scripts/build-release-manifest.ts`
- JSR / OCI / Helm workflow run evidence from `/operations/release-artifacts`
  when publishable artifacts changed
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

| Product root                                                                   | Required local gate                                                                                                                                            | Promotion owner            | Production deploy path                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `takos/`                                                                       | `deno task release-gate`                                                                                                                                       | Takos release owner        | `takos-private/`                                                                      |
| `takos/app/`                                                                   | `deno task check`, `deno task test`, web build when UI changes                                                                                                 | Takos app owner            | `takos-private/apps/control`                                                          |
| `takos/git/`                                                                   | `deno task check`, `deno task test`                                                                                                                            | Takos Git hosting owner    | `takos-private/`                                                                      |
| `takos/agent/`                                                                 | `cargo test`, `cargo test --features mock-llm`                                                                                                                 | Takos agent owner          | `takos-private/`                                                                      |
| `takosumi/`                                                                    | `deno task check`, `deno task test`, `deno task publish:dry-run`                                                                                               | Takosumi owner             | JSR / image release, then Takos intake                                                |
| Takosumi Accounts (`takosumi.account.auth@v1` / `takosumi.account.billing@v1`) | `deno task check`, `deno task test`, OIDC integration smoke                                                                                                    | Takosumi Accounts owner    | Takosumi infra layer release; promotion path through takosumi-cloud operator pipeline |
| `takosumi-git/`                                                                | `deno task check`, `deno task test`                                                                                                                            | takosumi-git owner         | JSR release, then Takos intake                                                        |
| `takos-cli/`                                                                   | `deno task check`, `deno task test`, `deno task compile`                                                                                                       | Takos CLI owner            | CLI release                                                                           |
| `takos-private/`                                                               | `deno task verify`, `deno task lint`, `deno task build:all`                                                                                                    | operator                   | live staging / production deploy                                                      |
| takosumi-cloud (NEW)                                                           | Phase 1.1 で新設、Takosumi Accounts service / AppInstallation ledger / dashboard / billing UI を host。release owner: takosumi-cloud team (Phase 1.1 後に確定) | takosumi-cloud owner (TBD) | takosumi-cloud operator pipeline                                                      |

## Release Artifact Pipelines

Semver tag based build / publish automation is defined in
[`/operations/release-artifacts`](/operations/release-artifacts). The boundary
is:

- `takosumi/` publishes JSR packages and the generic `takosumi` OCI image.
- `takosumi-git/` publishes its JSR packages and CLI.
- `takos/` publishes Takos service OCI images and the Takos Helm chart.

Do not publish mutable `latest` as the only release reference. Production
promotion must reference immutable image digests, JSR package versions, and Helm
chart versions in the sign-off evidence.

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
