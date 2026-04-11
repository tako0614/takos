# Takos Docs-First Target Model

docs 整合のために固定する target model。実装判断で迷う場合はこの文書より public docs を優先し、この文書はその適用ルールを補足する。

## Canonical Public Surface

- deploy entrypoint は `takos deploy` のみ
- preview は standalone command ではなく `takos deploy --plan`
- install は catalog resolution を行う `takos deploy` の sugar
- rollback は group の previous successful snapshot を再適用する操作
- uninstall は group の desired state を空にしたうえで managed resources と group row を削除する terminal 操作
- manifest の public schema は flat top-level の `.takos/app.yml` のみ

## Canonical Model

- `primitive` は compute / storage / route / publish の 1st-class entity
- `group` は primitive を束ねる optional bundling layer
- `app deployment` は local manifest / repo deploy / install のどれでも immutable snapshot を作る
- `source` は provenance であり lifecycle の別物ではない
- `desired state` は group にひもづく canonical manifest projection

## Compatibility Rules

- hidden legacy CLI command は互換のために残してよいが、public help と current docs に出さない
- deprecated manifest type alias は既存 deploy code の移行が終わるまで許容するが、新規コードでは使わない
- envelope schema は parser の public entrypoint では受けない
- legacy field alias を受ける場合は parser compatibility に閉じ込め、canonical output は必ず docs の field 名に正規化する

## Required Guards

- CLI help contract test: `deploy`, `rollback`, `install`, `uninstall`, `group`, `resource` を current surface として固定する
- removed legacy surface test: `apply`, `plan`, `api`, `service` を public help に出さない
- manifest contract test: docs 例の worker/service/attached-container/publish が parse できる
- dependency contract test: `compute.<name>.depends` は compute と storage の両方を許可する

## Migration Order

1. parser と CLI help の public contract を test で固定する
2. deploy 内部の canonical type import に寄せる
3. 補助文書と user-facing copy の legacy surface を削る
4. rollback event など未完了の lifecycle semantics を current docs に揃える
