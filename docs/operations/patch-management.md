# Operations: Patch Management

> このページでわかること: Takos operated environments の container base image、
> OS-level CVE、runtime dependency update、例外処理、週次自動 scan / update path。

この runbook は Phase E GA readiness の patch management 正本です。Takos は
基本 Web/API surface として運用し、CLI は primary customer UX として扱いませ
ん。CLI / manifest workflows から発生する更新は `takosumi` /
`takosumi-git` の owning repo で扱い、Takos product shell は app / git /
agent / deploy artifact の patch gate を所有します。

## Scope

| Area | Owner | Automatic path |
| --- | --- | --- |
| Takos shell submodule pointers | `takos/` | `.github/dependabot.yml` `gitsubmodule` updates |
| GitHub Actions versions | each owning repo | Dependabot `github-actions` updates |
| Takos app container base image | `takos/app` | Dependabot `docker` for `/apps/control` |
| Takos Git container base image | `takos/git` | Dependabot `docker` for `/` |
| Takos agent container base image | `takos/agent` | Dependabot `docker` for `/` |
| Takos agent Rust deps | `takos/agent` | Dependabot `cargo` for `/` |
| Deno dependencies | each Deno repo | `deno outdated --update` during patch window |
| OS package CVEs | owning Dockerfile repo | weekly Trivy filesystem scan + image rebuild |

`takos-private/` owns private deploy credentials and environment-specific
secret rotation. This public policy references private run logs only by
boundary, never by secret name or provider account id.

## Base Image Rules

- Dockerfiles must not use `latest`, untagged images, or Deno / Rust
  major-only tags such as `denoland/deno:2`.
- Language runtime images must use a minor / patch tag, for example
  `denoland/deno:2.7.10` or `rust:1.94-bookworm`.
- Distro suite tags such as `debian:bookworm-slim` are allowed only when the
  image is rebuilt weekly and Trivy scan evidence is green.
- Production image references in deploy manifests must be immutable digest
  refs after build / promotion.
- Dockerfile package installs must use `--no-install-recommends` for Debian
  based images or `--no-cache` for Alpine based images.

The gate for these rules is:

```bash
cd takos
deno task validate:patch-management
```

`validate:patch-management` is part of the Takos release gate.

## Weekly Automation

`.github/workflows/patch-management.yml` runs every Tuesday at 04:24 UTC and on
manual dispatch.

It performs:

- policy validation through `deno task validate:patch-management`
- Trivy filesystem scan for HIGH / CRITICAL vulnerabilities and Dockerfile
  misconfiguration

Dependabot opens update PRs for:

- `takos/` submodule pointers
- GitHub Actions versions
- Docker base images in `takos/app`, `takos/git`, and `takos/agent`
- Rust dependencies in `takos/agent`

Deno does not use Dependabot for `deno.json` dependency updates. During the
weekly patch window, the owning repo runs:

```bash
deno outdated --update --lockfile-only
deno task check
deno task test
deno task lint
deno task fmt:check
```

If a Deno repo does not define all tasks, run the closest local equivalents
from that repo's `AGENTS.md`.

## Patch Window

Default weekly patch window:

- Tuesday 13:00-15:00 JST for staging update PR review.
- Wednesday 13:00-15:00 JST for production promotion when staging is green.

Emergency patch window:

- Open immediately for actively exploited CVEs, known secret exposure, or
  public remote code execution in an internet-facing service.
- Freeze unrelated deploys while the emergency patch is being validated.

## Severity SLA

| Severity | Target | Required action |
| --- | --- | --- |
| Critical exploited / internet-facing RCE | 24h | emergency patch, staging proof, production promotion |
| Critical not known exploited | 72h | patch PR, rebuild image, production promotion |
| High | 7 days | normal patch window |
| Medium | 30 days | next planned dependency refresh |
| Low | best effort | batch with routine updates |

If a CVE is not exploitable because the affected package is absent at runtime
or the vulnerable path is unreachable, record a time-boxed exception.

## Exception Record

Exceptions must include:

- CVE id or advisory id
- affected image / dependency / package
- affected service
- reason the issue is accepted temporarily
- compensating control
- owner
- expiry date
- link to tracking issue or private run log

Exceptions longer than 30 days require explicit product owner approval.

## Promotion Checklist

Before a patch PR is promoted:

- Dependency / image update PR is merged in the owning repo.
- Docker image rebuild uses the updated base image.
- Trivy scan is green or exceptions are recorded.
- Service-local tests are green.
- `takos` release gate is green.
- Staging deploy is healthy for one observation window.
- Rollback image digest is known.

## Evidence

Public evidence:

- Dependabot PR links.
- `patch-management` workflow run.
- `validate:patch-management` output.
- Release gate summary.

Private evidence:

- Provider account ids.
- Secret rotation logs.
- Cloud billing account evidence.
- Production deploy operator log.
