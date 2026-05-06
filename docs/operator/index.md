# Operator

Takos operator 向けの運用入口です。Takos product は Web UI / public API を
primary surface とし、初回セットアップ、OAuth、アカウント、PAT、課金、catalog
管理は Takos app から扱います。

CLI を primary UX にしません。manifest deploy engine や git/workflow bridge
を直接扱う場合の CLI は `takosumi` / `takosumi-git` の責務です。Takos product
側の CLI は互換・補助用途に限定し、新しい operator bootstrap
導線として増やさないでください。

## 現在の app 境界

`takos/app` の目標境界は次の通りです。

- `apps/api`: browser / API-facing gateway。trusted edge actor headers と直接
  browser session / PAT / OAuth bearer を検証し、OAuth / account / profile /
  billing の public entrypoint もここで受ける
- `apps/control`: まだ切り出していない login / OAuth state / account / profile /
  billing business logic の legacy compatibility backend。migration window 中は
  `apps/api` から proxy される

operator docs では Web UI / public API を Takos product の primary surface
として扱います。manifest deploy engine や workflow / git bridge を CLI
で扱う場合は `takosumi` / `takosumi-git` 側の責務です。

## 読む順番

1. [OAuth Setup](/operator/oauth-setup) で admin domain、Google OAuth callback、
   secret 経路を固定する
2. [Bootstrap](/operator/bootstrap) で初回 operator account を作り、Web UI から
   PAT を発行する
3. [API Reference](/reference/api) で PAT / OAuth / setup API の詳細を確認する

## 原則

- operator の初回操作は Web UI を使う
- automation は Web で発行した PAT を secret store に保存して使う
- deploy 設定や secret の本番操作は `takos-private/` を正本にする
- application の git / workflow / manifest authoring CLI は `takosumi-git`
  に寄せる
- Takosumi kernel の direct CLI は explicit manifest path を受けるだけで、
  `.takosumi/` project convention を持たない
