# リファレンス

Takos を使ってサービスとソフトウェアを構成・配備するときに参照する、CLI / API /
deploy manifest / 用語集の章。Takos Deploy では deploy lifecycle は `Deployment`
record に対する 5 verb (`deploy` / `apply` / `diff` / `approve` / `rollback`) と
1 endpoint family (`POST /api/public/v1/deployments` ほか) で 表現されます。

このセクションには Takos docs の **canonical な参照点**が 2 つ含まれます:

- **[Manifest Spec](/reference/manifest-spec)** — deploy manifest の
  SoT。canonical minimal manifest yaml と全 field 定義の正本
- **[Glossary](/reference/glossary)** — 用語集の SoT。Core meta-objects
  (Deployment / ProviderObservation / GroupHead) と v2 → deployment migration
  alias、 publication descriptor の canonical ref、 `bindings[]` の canonical 形式、 Workers
  backend implementation note を集約

| 確認したいこと                                            | ページ                                    |
| --------------------------------------------------------- | ----------------------------------------- |
| CLI コマンド (deploy / apply / diff / approve / rollback) | [CLI](/reference/cli)                     |
| CLI 認証モデル                                            | [CLI / Auth model](/reference/cli-auth)   |
| API family と Deployment endpoint                         | [API](/reference/api)                     |
| control plane の DB schema (PaaS Core 含む)               | [Database](/reference/database)           |
| deploy manifest の全フィールド                            | [Manifest Spec](/reference/manifest-spec) |
| 用語の意味 (Core record / manifest contract)              | [用語集](/reference/glossary)             |
