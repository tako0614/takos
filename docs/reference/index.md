# リファレンス

Takos を使ってサービスとソフトウェアを構成・配備するときに参照する、CLI / API /
deploy manifest / 用語集の章。takosumi kernel の deploy lifecycle は compiled
Shape manifest を受け取る `POST /v1/deployments` と Deployment record で表現され
ます。Takos product API は別 surface として扱います。

このセクションには Takos docs の **canonical な参照点**が 2 つ含まれます:

- **[Manifest Spec](/reference/manifest-spec)** — deploy manifest の SoT。Shape
  manifest の canonical minimal yaml と全 field 定義の正本
- **[Glossary](/reference/glossary)** — 用語集の SoT。Core meta-objects
  (Deployment / ProviderObservation / GroupHead)、ManifestResource、AppBinding、
  cross-instance imports、Workers backend implementation note を集約

| 確認したいこと                                            | ページ                                    |
| --------------------------------------------------------- | ----------------------------------------- |
| CLI コマンド (deploy / apply / diff / approve / rollback) | [CLI](/reference/cli)                     |
| CLI 認証モデル                                            | [CLI / Auth model](/reference/cli-auth)   |
| API family と Deployment endpoint                         | [API](/reference/api)                     |
| control plane の DB schema (PaaS Core 含む)               | [Database](/reference/database)           |
| deploy manifest の全フィールド                            | [Manifest Spec](/reference/manifest-spec) |
| 用語の意味 (Core record / manifest contract)              | [用語集](/reference/glossary)             |
