# Takos 全体像

> このページでわかること: Takos がユーザーに提供する体験と、その裏側で Takosumi が何を管理するか。

Takos は chat、agent、memory、Git、Workspace、app launcher、MCP tools を一つの作業環境として使うための
AI workspace distribution です。ユーザーが触る中心は Workspace、チャット、ファイル、リポジトリ、アプリ、ツールです。

アプリや追加サービスは Git URL から入る plain OpenTofu Capsule として install されます。Takos 専用 manifest や
Takosumi 専用 DSL は要求しません。Takosumi は裏側で Account、Source、Capsule、ProviderConnection、
ProviderBinding、Run、StateVersion、Output、policy、audit、dashboard、OpenTofu runner を外部 control plane として管理します。

Self-host された Takos distribution は `takos/deploy/opentofu` の `tofu apply` と worker artifact upload で動きます。この
module は distribution worker の durable backing infrastructure を provision し、external Takosumi control plane が review/apply
ledger と policy evidence を記録します。公開 hosted operator を使う場合も、ユーザー体験は Workspace / Apps / Chat に収束し、
operator が Takosumi Account、Workspace / Project / Capsule、compatibility capability、provider policy を運用します。

`takos-office`, `takos-computer`, `yurucommu` は、ユーザーが選んで追加できる installable app です。
新しい Workspace に自動 install されるものではなく、追加された後は ledger 上も通常の Capsule app として扱われます。

## 基本概念

### Takosumi Account

ログイン、契約、課金、OIDC issuer の単位です。Takos は app-local profile / preferences / chat data を持ちますが、identity
level の正本は Takosumi Accounts plane が所有します。

### Takos Workspace

chat、agent、memory、Git repository、app launcher、MCP tools をまとめる Takos 内の作業空間です。

### Takosumi Workspace / Project / Capsule

Workspace / Project / Capsule / Source / ProviderConnection / ProviderBinding / Run / StateVersion / Output /
AuditEvent を保持する owner boundary です。Resource Shape API の `Space` は shape namespace / policy scope であり、
Takos Workspace とは別です。

### App / Capsule

アプリは Git URL から入る OpenTofu Capsule です。Takosumi が Source と Capsule を登録し、plan / apply /
destroy Run、StateVersion、Output を記録します。Takos の app 一覧、launcher、MCP service は Capsule Output と
Takos runtime contract から投影される product surface です。

## 始め方

| 方法             | 対象             | 概要                                                                                   |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------- |
| Use Takos        | すぐに使いたい人 | 公開 operator または rehearsal 環境で Account / Workspace を作成して chat へ進む       |
| Install from Git | 開発者           | Git URL の Capsule を Workspace / Project に install し、reviewed plan を approve する |
| Self-host        | 自前運用したい人 | OpenTofu module + wrangler artifact upload で Takos を deploy する                     |

3 path は同じ ownership model に収束します。違うのは operator が誰か、どの runtime mode を選ぶか、どの Connection / policy を使うかです。

## 代表的なユースケース

### すぐに Takos を使いたい

公開 operator が signup を開いている場合、「Use Takos」から Takosumi Account / Takos Workspace を作成し、必要な app を選んで
追加してから chat を始めます。public signup が closed の間は、operator が用意した rehearsal 環境または Self-host path で同じ
journey を検証します。

### 自分のアプリをデプロイしたい

アプリのコードを OpenTofu Capsule として Git リポジトリに置き、Git URL を指定して install します。Takosumi が Source、
Capsule、Run、StateVersion、Output を記録し、Takos は launcher / MCP / file handler などの product surface に
投影します。

### 完全にセルフホストしたい

Takos を自分の origin に deploy し、Takosumi control plane、provider credentials、backup / DR、billing policy を自分で管理します。
その Takosumi deploy-control が Capsule / Run / StateVersion / Output を記録します。

## 次に読むページ

- [Install paths](/apps/install-paths) — 3 path の違い
- [はじめる](/get-started/) — 最初のセットアップ
- [Deploy 構成](/deploy/) — Cloudflare reference topology
- [アーキテクチャ](/architecture/) — 内部構造
- [Takosumi model](https://takosumi.com/docs/reference/model) — Capsule / Run / StateVersion / Output の正本
