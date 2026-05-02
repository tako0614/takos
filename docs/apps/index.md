# アプリ構成

Takos の app 機能 (Store / launcher / file handler / OAuth client / MCP
server 等) の使い方をまとめた章です。 「app」とは Store / UI 上の product
label で、 deploy model 上は普通の primitive (component / route /
publication / resource / binding) として表現されます
([Kernel § Primitive と group](/architecture/kernel#primitive-と-group))。

deploy manifest の書き方そのものは
[デプロイ章 § マニフェスト](/deploy/manifest) を参照。

## セクション別ガイド

| ガイド                            | 内容                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| [MCP Server](/apps/mcp)           | `publication.mcp-server@v1` で MCP endpoint を公開する        |
| [OAuth](/apps/oauth)              | `takos.oauth-client` で OAuth client を受け取る               |
| [File Handlers](/apps/file-handlers) | `publication.file-handler@v1` で MIME / 拡張子 handler を公開する |

## deploy 系の関連ドキュメント

| ガイド                                                                           | 内容                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Deploy Manifest](/deploy/manifest)                                              | `.takos/app.yml` の全体像、 パターン、 完全な例                                   |
| [Routes](/deploy/routes)                                                         | `routes[]` の declaration                                                         |
| [環境変数](/deploy/environment)                                                  | env / binding の詳細                                                              |
| [マニフェストリファレンス](/reference/manifest-spec)                             | normative な field 定義                                                           |
| [Authoring Guide](/takos-paas/guides/authoring-guide)                            | authoring → canonical 展開の写像                                                  |
| [Official Descriptor Set v1](/takos-paas/descriptors/official-descriptor-set-v1) | runtime / artifact / interface / route / resource / publication descriptor 一覧  |

## 次のステップ

- [Takos 全体像](/overview/) --- platform と用語から理解する
- [Kernel](/architecture/kernel) --- Takos kernel と group の境界を確認する
- [Deploy Manifest](/deploy/manifest) --- group 定義の中心となる spec を確認する
- [サンプル集](/examples/) --- コピペで始められるサンプル
