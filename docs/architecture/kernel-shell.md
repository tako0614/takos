# Kernel / Workspace Shell / Apps

::: tip Status このページは Takos の current product contract
を定義します。実装に builtin UI や hardcoded catalog
が残っていても、プロダクト境界はこのページを正本として扱います。 :::

## Takos の定義

Takos は次の 2 つを提供する platform です。

- infra kernel
- workspace shell

`Store`、`Repos`、`Chat`、`Agent` のようなプロダクト UI は Takos
本体そのものではなく、Takos 上で動く installable app として扱います。first-party
app も third-party app も同じ app contract に乗せます。

## Kernel の責務

Kernel は「workspace を安全に動かすための共通基盤」を担当します。

- identity / auth
- workspace / space / principal
- capability grant
- app install / deploy / reconcile / rollback
- routing / hostname / invocation
- resource broker
- metering / billing / audit
- workspace bootstrap に必要な最小の app management API

Kernel が責任を持たないもの:

- `Store` 固有の catalog UX
- `Repos` 固有の git UX
- `Chat` / `Agent` 固有の会話 UX
- app ごとの canonical navigation

## Workspace Shell の責務

Workspace shell は Takos の最小 UI です。workspace と infra を見るための shell
であり、各 app の本体 UI ではありません。

- workspace の切り替え
- resources / deploys / members / settings の表示
- installed apps の一覧
- app の install / uninstall / launch
- app を iframe で開くか redirect するかの判断

Shell は `Store` がなくても成立する必要があります。richer な discovery や
recommendation は app に寄せ、shell 側には bootstrap
に必要な最小機能だけを残します。

## Installable Apps

Installable app は workspace に接続されるプロダクト surface です。

- first-party app も third-party app も同格
- default app として preinstall できる
- uninstall / replace できる
- 特権は app 種別ではなく capability grant で決まる

新規 workspace では template によって default apps を preinstall
できます。これは「system app を特別扱いする」ためではなく、初期 UX
を整えるための bootstrap です。

## URL model

Takos は canonical URL と shell launch URL を分けます。

| 種別                | owner           | 用途                                      |
| ------------------- | --------------- | ----------------------------------------- |
| canonical URL       | app             | bookmark / share / reload / direct access |
| shell launch URL    | workspace shell | Takos UI から app を開く                  |
| compatibility alias | shell resolver  | 既存 shortcut を壊さず移行する            |

### Canonical URL

app が所有する正本 URL です。`/chat/:spaceId`、`/repos/:spaceId`、`/store`
のような URL は引き続き app 側が owner です。

### Shell launch URL

Takos UI から app を開くための workspace-scoped URL です。例として
`/apps/:spaceId/open/:appId` のような launch route を持ちます。shell はここで
app の launch descriptor を解決し、`iframe` か `redirect`
のどちらで開くかを決めます。

### Compatibility alias

既存の `/app/:appId` のような shortcut route は compatibility alias
として残せます。workspace 文脈がある場合は shell launch URL
に寄せ、文脈がない場合は canonical URL に解決します。

## App launch contract

Takos UI から app を開くとき、shell は app の canonical URL
を奪いません。代わりに launch descriptor を解決して開き方だけを決めます。

- `open_mode=iframe`: shell が canonical URL を iframe で開く
- `open_mode=redirect`: shell が canonical URL へ遷移する
- shell は short-lived launch token と return target を app に渡せる
- app は shell 対応していなくても canonical URL だけで単独動作できる

iframe は integration 手段であり、URL の source of truth ではありません。

## `.takos/app.yml` の位置づけ

`.takos/app.yml` は引き続き app の deploy/runtime contract です。

- workloads
- resources
- routes
- bindings
- OAuth
- MCP
- file handlers

このフェーズでは、shell integration や canonical URL / shell launch URL の方針は
`.takos/app.yml` に入れません。shell 側の launch metadata と app registry
で扱います。

## Default apps と bootstrap

Takos は workspace template により default apps を preinstall
できます。想定する初期セットは `Chat`、`Repos`、`Store` ですが、これらは shell
と同格の app です。

- shell は minimal な install / uninstall / launch UI を持つ
- `Store` は richer な discovery / recommendation / catalog UX を持つ
- workspace は default app を削除・差し替えできる

この方針により、現在の UX を保ちながらも Takos 本体の責務を infra kernel と
workspace shell に限定できます。
