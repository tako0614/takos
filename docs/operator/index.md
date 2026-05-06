# Operator

Takos operator 向けの運用入口です。Takos product は Web UI / public API
を primary surface とし、初回セットアップ、OAuth、アカウント、PAT、課金、catalog
管理は Takos app から扱います。

CLI を primary UX にしません。manifest deploy engine や git/workflow bridge
を直接扱う場合の CLI は `takosumi` / `takosumi-git` の責務です。Takos product
側の CLI は互換・補助用途に限定し、新しい operator bootstrap 導線として増やさないでください。

## 現在の app 境界

`takos/app` の目標境界は次の通りです。

- `apps/api`: browser / API-facing gateway の移行先。将来は session / PAT / OAuth
  token 検証もここで扱う
- `apps/control`: 未移行 public route の legacy compatibility app。現在の login /
  OAuth / account / profile / billing route の多くはここに残る

現時点の `apps/api` は trusted-proxy gateway です。直接 browser session / PAT /
OAuth bearer を検証せず、上流の trusted edge が authenticate して
`x-takos-internal-secret` を付ける前提です。operator docs では、いま動く Web
route と、移行後の正本境界を分けて扱います。

## 読む順番

1. [OAuth Setup](/operator/oauth-setup) で admin domain、Google OAuth callback、
   secret 経路を固定する
2. [Bootstrap](/operator/bootstrap) で初回 operator account を作り、Web UI
   から PAT を発行する
3. [API Reference](/reference/api) で PAT / OAuth / setup API の詳細を確認する

## 原則

- operator の初回操作は Web UI を使う
- automation は Web で発行した PAT を secret store に保存して使う
- deploy 設定や secret の本番操作は `takos-private/` を正本にする
- application の git / workflow / manifest authoring CLI は `takosumi-git`
  に寄せる
- Takosumi kernel の direct CLI は explicit manifest path を受けるだけで、
  `.takosumi/` project convention を持たない
