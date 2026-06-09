# Git / Store からのインストール

> このページでわかること: Store や Git URL からアプリをインストールする手順。

Store はインストール可能な Git
リポジトリを見つけるための画面です。インストールの所有権、承認、課金、バインディングは
Takosumi Accounts が管理します。

## 基本

```bash
takosumi install --source git:https://github.com/acme/my-app#v1.2.0 --space "$TAKOSUMI_SPACE_ID"
```

browser / dashboard から始める場合も、最終的には同じ install lifecycle
に入ります。

```text
User
  -> Store / install UI
  -> Takosumi: Installation 作成 (plain OpenTofu module を解決)
  -> `plan` type Run (planned changes / policy decision を記録)
  -> reviewed plan を approve
  -> `apply` type Run
  -> Deployment / OutputSnapshot 更新
```

## Store の責務

- repository を検索・発見する
- publisher、version、tag、Git URL を表示する
- plain OpenTofu module がある repository を install candidate として扱う
- Installation 作成へ進むための module metadata (Git URL / ref / commit / tag / well-known OpenTofu outputs) を渡す

Store は deploy 実行主体ではありません。Installation 作成、typed Runs 実行、
Deployment / OutputSnapshot 更新は Takosumi deploy control plane、ownership と
approval は operator account plane (reference impl: Takosumi Accounts)
が担当します。provider allowlist / credential / state backend / Cloudflare Container execution は
Connection / ProviderBinding / policy で解決し、Store contract の外に置きます。

## Platform services projection

Store は Space の Installation readback を Takosumi Accounts から読み、installed state と一緒に
Workload Services の非 secret summary を表示します。対象は OIDC identity、billing port、
OutputSnapshot、event ingest、same-space control などの account-plane / operator-owned
services です。

Takos が保持・表示するのは service id、material kind、status、endpoint、secret 設定済みかどうか、
token expiry までです。token 本体、provider credential、state backend、secret output は Store に渡さず、
Takosumi Accounts / Connection / ProviderBinding / policy / operator secret store の責務に残します。

## `plan` type Run review

`plan` type Run は mutate しない確認 step です。少なくとも次を表示します。

- module Git URL / ref / resolved commit
- publisher metadata / homepage
- planned changes / policy decision
- runtime mode
- estimated cost
- data exportability

reviewed plan を approve すると `apply` type Run が実行され、成功した apply が
Deployment と OutputSnapshot を更新します。Installation / `plan` type Run /
`apply` type Run / Deployment / OutputSnapshot と audit trail は ledger
に記録されます。

## Version pinning

install は tag または commit SHA に pin します。mutable branch を production
install の identity として扱いません。upgrade は新しい ref で `plan` type Run
を作り直し、 reviewed plan を approve した `apply` type Run が新しい Deployment を
Installation に記録します。

## 関連ページ

- [Install Paths](/apps/install-paths)
- [Apps overview](/apps/)
- [Project structure](/get-started/project-structure)
- [Takosumi Deployment lifecycle](/deploy/deploy)
