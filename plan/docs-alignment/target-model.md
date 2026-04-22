# Takos Docs Alignment

この文書を `plan/docs-alignment/` の単一の整理メモとする。public docs
が正本で、この文書は current contract を実装・docs 修正時にぶらさないための
補助メモです。

## Current Public Contract

- deploy entrypoint は `takos deploy`。preview は `takos deploy --plan`。
  `takos install` は catalog resolution を行う `takos deploy` の sugar。
- deploy manifest は flat top-level の `.takos/app.yml` / `.takos/app.yaml`。
  filename には `app` が残るが、意味上は app catalog ではなく group deploy
  manifest。
- public manifest の top-level field は `name`, `version`, `compute`,
  `resources`, `routes`, `publish`, `env`, `overrides`。`provider` / `backend`
  は current manifest field ではない。
- backend / adapter 選択は operator-only runtime configuration。public manifest,
  public API request, examples には backend 名を書かない。
- deploy lifecycle の正本語は group deployment snapshot。source kind (`manifest`
  / `git_ref`) は provenance であり lifecycle の差ではない。
- `publish` は typed outputs publication catalog。route/interface metadata と
  route output を扱う。
- Takos API key / OAuth client は `publisher: takos` ではなく、Takos built-in
  provider publication (`takos.api-key` / `takos.oauth-client`) を
  `compute.<name>.consume[]` で request する。SQL / object-store / queue などの
  resource type は built-in provider publication ではない。
- route publication の `type` は custom string。`McpServer` / `FileHandler` /
  `UiSurface` は platform / app が解釈する custom type の例で、core の固定 type
  ではない。
- resource lifecycle は manifest の `resources`、`/api/resources/*`,
  `takos resource|res`, runtime binding の責務。resource access を
  `publish[].spec.resource` や `type: resource` で表現しない。
- `compute.<name>.consume` は publication output を env に注入する明示的な
  dependency edge。`consume.env` は output 名 -> env 名の alias map であり、
  output filter ではない。自動注入はしない。

## Implementation Alignment Rules

- parser は envelope schema (`apiVersion` / `kind` / `metadata` / `spec`) を
  public entrypoint で受けない。
- parser compatibility が legacy alias を受ける場合でも、canonical output は
  public docs の field 名に正規化する。
- hidden legacy CLI command は互換層として残してよいが、public help と current
  docs には出さない。
- deploy HTTP API / tool / docs は
  `/api/spaces/:spaceId/group-deployment-snapshots` と
  `group_deployment_snapshot_*` を canonical surface とする。
- service-level desired state は runtime materialization / next-deploy settings
  として扱い、group manifest と同格の public desired state に見せない。
- resource CRUD から group desired manifest への逆投影は current public contract
  ではない。既存 foundation を group に所属させる操作は inventory
  操作として扱う。
- resource creation / runtime binding は `resources` か resource API 側に寄せ、
  publish / consume へ混ぜない。

## Required Guards

- CLI help contract: `deploy`, `rollback`, `install`, `uninstall`, `group`,
  `resource` を current surface として固定する。
- removed legacy surface: `apply`, `plan`, `api`, `service` を public help
  に出さない。
- manifest contract: docs 例の worker / service / attached-container / publish /
  consume が parse できる。
- dependency contract: `compute.<name>.depends` は compute
  名だけを許可し、resource dependency は resource lifecycle / runtime binding
  に寄せる。
- terminology guard: public deploy docs で `app deployment` や provider-specific
  deploy surface を canonical term として増やさない。
