# アプリ構成

Takos の "app" には **2 つの意味** があります。Installable App Model の登場で
両者を区別する必要が生まれたので、最初に整理します。

## "App" の 2 つの意味

| 意味                       | 文脈                                                | 単位                                                                                                                                            |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **App** (Store / UI label) | Store / launcher / file handler / MCP / 等の既存 UI | product label。deploy 上は Shape resources と app metadata / registry entry の組み合わせで表現される                                            |
| **InstallableApp**         | Installable App Model (`.takosumi/app.yml`)         | Git URL から install される単位。`apiVersion: app.takosumi.dev/v1` / `kind: InstallableApp`。AppInstallation 台帳に行を持つ owner-scoped record |

- **App = Store label** は従来どおり維持されます。Store / launcher / file
  handler / MCP server などの既存ガイドはこの意味の "app" を扱います。MCP / file
  handler / launcher の discovery metadata は kernel manifest の
  `publications[]` ではなく、Takos app catalog / runtime registry の surface
  です。
- **InstallableApp** は `.takosumi/app.yml` の `kind` 値で、Git URL から install
  される owner-scoped な単位です。Takos 自身も `id: takos.chat` の
  InstallableApp として install されます。

両者は矛盾しません。**1 つの InstallableApp が、自分の中に複数の App (Store
label) を出してもよい**、という二段構造です。

詳しい全体像は [Installable App Model](/architecture/installable-app-model)、
deploy manifest の書き方そのものは [デプロイ章 § マニフェスト](/deploy/manifest)
を参照。

## セクション別ガイド

### Installable App Model 系 (新)

| ガイド                               | 内容                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| [Install Paths](/apps/install-paths) | `Use Takos` / `Install from Git` / `Self-host` の 3 path  |
| [OIDC Consumer](/apps/oidc-consumer) | Takos が要求する OIDC env / route / callback の正本       |
| [Launch Token](/apps/launch-token)   | `/_takosumi/launch` で受ける install bootstrap JWS の検証 |

### App (Store label) 系

| ガイド                               | 内容                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [MCP Server](/apps/mcp)              | Shape resource で HTTP endpoint を deploy し、MCP registry metadata を登録する                                 |
| [OIDC Consumer](/apps/oidc-consumer) | Takos が OIDC consumer として要求する env / route / claim。OAuth/OIDC issuer は Takosumi Accounts に集約される |
| [File Handlers](/apps/file-handlers) | Shape resource で handler UI を deploy し、file handler metadata を登録する                                    |

## deploy 系の関連ドキュメント

| ガイド                                                              | 内容                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Deploy System](/architecture/deploy-system)                        | 3 種の deploy path (Install / Upgrade / GitOps binding)                            |
| [Installer Pipeline](/architecture/installer-pipeline)              | takosumi-git の install pipeline 13 step                                           |
| [AppInstallation 台帳](/architecture/app-installation)              | InstallableApp の owner record と status 遷移                                      |
| [.takosumi/app.yml spec](/reference/app-yml-spec)                   | InstallableApp v1 の field 定義                                                    |
| [Binding Catalog](/reference/binding-catalog)                       | `identity.oidc@v1` 等 6 種の binding type                                          |
| [Install API](/reference/install-api)                               | `POST /v1/install/preview` / `POST /v1/installations` 等                           |
| [Deploy Manifest](/deploy/manifest)                                 | `.takosumi/manifest.yml` (kernel-bound) の全体像、 パターン、 完全な例             |
| [Routes](/deploy/routes)                                            | legacy route docs から Shape resource route への migration                         |
| [環境変数](/deploy/environment)                                     | env / AppBinding materialization の詳細 (OIDC_ISSUER_URL / DEPLOY_INTENT_* を含む) |
| [マニフェストリファレンス](/reference/manifest-spec)                | normative な field 定義                                                            |
| [Authoring Guide](/takosumi/guides/authoring-guide)                 | authoring → canonical 展開の写像                                                   |
| [App Integration Metadata Boundary](/architecture/app-publications) | app metadata / AppBinding / Shape manifest の境界                                  |

## 次のステップ

- [Installable App Model](/architecture/installable-app-model) --- Takos が
  install される app である理由と全体像
- [Install Paths](/apps/install-paths) --- 3 種の install path から自分に
  合うものを選ぶ
- [OIDC Consumer](/apps/oidc-consumer) --- Takos が要求する OIDC env / route の
  正本
- [Takos 全体像](/overview/) --- platform と用語から理解する
- [Kernel](/architecture/kernel) --- compute substrate としての kernel 境界
- [Deploy Manifest](/deploy/manifest) --- group 定義の中心となる spec を確認する
- [サンプル集](/examples/) --- コピペで始められるサンプル
