# Deploy 構成

Takos を使ってサービスやソフトウェアを構成するときに使う public surface
をまとめた章です。中心になるのは deploy manifest (`.takos/app.yml`) ですが、
manifest だけでなく Workers、Containers、Routes、環境変数、MCP、OAuth、File
Handlers の関係もここで扱います。

この章が扱うのは group の deploy/runtime contract です。Takos の product
boundary は [Kernel](/architecture/kernel) を参照。

## 最小構成

最小 manifest は `name` / `compute.web.build.fromWorkflow` / `routes` の 3 ブロックで成立する。
詳細な canonical 例は
[Canonical minimal manifest](/reference/manifest-spec#canonical-minimal-manifest)
を参照。各章 (apps / examples / get-started / deploy) で minimal example を出すときは、この canonical を引用するか短い変形のみとする。

## セクション別ガイド

| ガイド                               | 内容                                           |
| ------------------------------------ | ---------------------------------------------- |
| [Deploy Manifest](/apps/manifest)    | `.takos/app.yml` の全体像、パターン、完全な例  |
| [Workers](/apps/workers)             | Worker workload の定義、ビルド、バインディング |
| [Services](/apps/services)           | always-on Service workload の定義              |
| [Containers](/apps/containers)       | worker-attached container workload の定義      |
| [Routes](/apps/routes)               | HTTP エンドポイントの公開                      |
| [環境変数](/apps/environment)        | テンプレート変数、値の注入                     |
| [MCP Server](/apps/mcp)              | MCP Server の公開と認証                        |
| [File Handlers](/apps/file-handlers) | ファイルハンドラーの登録                       |
| [OAuth](/apps/oauth)                 | OAuth client の自動登録                        |

## 次のステップ

- [Takos 全体像](/overview/) --- platform と用語から理解する
- [Kernel](/architecture/kernel) --- Takos kernel と group の境界を確認する
- [Deploy Manifest](/apps/manifest) --- group 定義の中心となる spec を確認する
- [サンプル集](/examples/) --- コピペで始められるサンプル
