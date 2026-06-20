# Takos 全体像

> このページでわかること: Takos がユーザーに提供する体験と、その裏側で Takosumi が何を管理するか。

Takos は chat、agent、memory、Git、Workspace、app launcher、MCP tools を一つの作業環境として使うための
AI workspace distribution です。ユーザーが触る中心は Workspace、チャット、ファイル、リポジトリ、アプリ、ツールです。

アプリや追加サービスは Git URL から入る plain OpenTofu Capsule として install されます。Takos 専用 manifest や
Takosumi 専用 DSL は要求しません。Takosumi は裏側で Account、Installation、Run、StateSnapshot、OutputSnapshot、
Dependency、policy、audit、dashboard、OpenTofu runner を同一 origin の distribution worker に compose して管理します。

Self-host された Takos distribution は `takos/deploy/opentofu` の `tofu apply` と worker artifact upload で動きます。この
module は distribution worker の durable backing infrastructure を provision し、embedded Takosumi services が review/apply
ledger と policy evidence を記録します。公開 hosted operator を使う場合も、ユーザー体験は Workspace / Apps / Chat に収束し、
operator が Takosumi Account、Space、Gateway coverage、provider policy を運用します。

バンドルアプリ (`takos-docs`, `takos-slide`, `takos-excel`, `takos-computer`, `yurucommu`) は新しい Workspace に
distribution seed として install されます。ledger 上は通常の Installation なので、不要なアプリはアンインストールできます。

## 基本概念

### Takosumi Account

ログイン、契約、課金、OIDC issuer の単位です。Takos は app-local profile / preferences / chat data を持ちますが、identity
level の正本は Takosumi Accounts plane が所有します。

### Takos product space

chat、agent、memory、Git repository、app launcher、MCP tools をまとめる Takos 内の作業空間です。

### Takosumi Space (`@handle`)

Installation / Connection / Run / OutputSnapshot / Activity を保持する owner namespace です。provider credential、policy、
audit trail もここに紐づきます。実装上の既存 API/DB 名に `space` が残る場合も、public docs では Takos product space と
Takosumi Space を分けて説明します。

### App / Installation

アプリは Git URL から入る OpenTofu Capsule です。Takosumi が Installation を作り、`plan` / `apply` /
`destroy_plan` / `destroy_apply` Run、Deployment、OutputSnapshot を記録します。Takos の app 一覧、launcher、MCP service は
Installation / OutputSnapshot / Service Graph から投影される product surface です。

## 始め方

| 方法             | 対象             | 概要                                                                                     |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Use Takos        | すぐに使いたい人 | 公開 operator または rehearsal 環境で Account / Space / Workspace を作成して chat へ進む |
| Install from Git | 開発者           | Git URL の Capsule を Space に install し、reviewed plan を approve する                 |
| Self-host        | 自前運用したい人 | OpenTofu module + wrangler artifact upload で Takos を deploy する                       |

3 path は同じ ownership model に収束します。違うのは operator が誰か、どの runtime mode を選ぶか、どの Connection / policy を使うかです。

## 代表的なユースケース

### すぐに Takos を使いたい

公開 operator が signup を開いている場合、「Use Takos」から Takosumi Account / Space / Takos Workspace を作成し、バンドルアプリが
seed された状態で chat を始めます。public signup が closed の間は、operator が用意した rehearsal 環境または Self-host path で同じ
journey を検証します。

### 自分のアプリをデプロイしたい

アプリのコードを OpenTofu Capsule として Git リポジトリに置き、Git URL を指定して install します。Takosumi が SourceSnapshot、
DependencySnapshot、Run、Deployment、OutputSnapshot を記録し、Takos は launcher / MCP / file handler などの product surface に
投影します。

### 完全にセルフホストしたい

Takos を自分の origin に deploy し、Takosumi Accounts plane、provider credentials、backup / DR、billing policy を自分で管理します。
同じ distribution worker 内の Takosumi deploy-control が Installation / Run / StateSnapshot / OutputSnapshot / Deployment を記録します。

## 次に読むページ

- [Install paths](/apps/install-paths) — 3 path の違い
- [はじめる](/get-started/) — 最初のセットアップ
- [Deploy 構成](/deploy/) — Cloudflare reference topology
- [アーキテクチャ](/architecture/) — 内部構造
- [Takosumi model](https://takosumi.com/docs/reference/model) — Installation / Run / OutputSnapshot の正本
