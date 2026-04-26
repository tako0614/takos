# Road to Takos 1.0

Takos 1.0 の目標は、Takos core を OSS GA として扱える状態にすることです。
固定の公開日は置かず、milestone の完了条件を満たしたら次へ進みます。

このページは公開向けの要約です。詳細な作業計画は `plan/road-to-1.0.md`
で管理します。

## 1.0 の対象

1.0 の対象は Takos core です。

- `takos/`
- `takos-cli/`
- `agent/` agent service

default app distribution は 1.0 の検証 fixture / example として使いますが、
core 1.0 の blocker にはしません。

## 1.0 で安定化する surface

1.0 では次を public compatibility target とします。

- deploy manifest: `.takos/app.yml` / `.takos/app.yaml`
- CLI: auth / endpoint / deploy / install / rollback / uninstall / group /
  resource / thread / run
- REST API: public docs に載せる route と common error envelope
- Agent / Thread / Run: Rust agent、skill resolution、remote tool execution、
  local memory tools、run events、usage reporting

internal container-host RPC は public compatibility target ではありません。

## Milestones

| Milestone | 目的 |
| --------- | ---- |
| M0 Contract Freeze | manifest / CLI / API / terminology の互換境界を固定する |
| M1 OSS Self-Host GA | OSS checkout だけで single-node production self-host を再現できるようにする |
| M2 Deploy / Git / API GA | deploy lifecycle、Git Smart HTTP、Store install、resource surface を安定化する |
| M3 Agent GA | Thread / Run、Rust agent、skills、remote tools、memory、usage reporting を production feature にする |
| M4 Release Hardening | release candidate、CLI artifact、docs、migration、smoke test を揃える |

## Hosting Target

1.0 の self-host target は single-node production です。

- PostgreSQL
- Redis
- S3-compatible object storage
- operator-managed TLS / reverse proxy

Kubernetes / Helm の production hardening は 1.0 後も継続して扱います。

## Agent Scope

1.0 の Agent GA では OpenAI official / OpenAI-compatible API
を production model backend として扱います。Anthropic / Google の first-class
GA、ANN vector index、distributed scheduler、planner / subgoal 専用 graph
preset、multi-agent memory federation は post-1.0 の対象です。

## Release Gate

1.0 release candidate は次を満たす必要があります。

- full CI が green
- docs lint / docs build が green
- clean-machine self-host smoke が通る
- CLI login / repo / deploy / rollback / uninstall が通る
- Agent run / event stream / tool call / memory restart smoke が通る
- critical / high severity blocker が 0
