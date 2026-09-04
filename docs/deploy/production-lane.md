# 本番デプロイレーン

Takos の本番 Worker は `bun run deploy -- takos-cloudflare-production` から配置します。
この surface は Takos を所有する repository の唯一の本番入口で、
[release artifact](/deploy/release-artifact) が公開した bytes を、OpenTofu module が
用意した account へ載せます。

## 2 つの半分

Takos の配置は 2 つの半分でできています。

| 半分 | 正本 | 所有するもの |
| --- | --- | --- |
| 耐久インフラ | `deploy/opentofu/cloudflare` | D1、KV、R2、Queue、Worker identity、queue consumer、cron |
| worker artifact | `deploy/cloudflare/wrangler.toml` | entry module、ASSETS、container image、Durable Object migration、route、binding |

Cloudflare provider は worker artifact 側を表現できません。さらに Vectorize index と
Container application は、どちらの半分の provider resource にも存在しません。
この surface はその 2 つを含めて、宣言された冪等な phase として実行します。

D1 の schema migration はこの surface の担当ではありません。Worker が起動時に自分で
適用します。code の upload と schema の変更は別の class なので、同じ mutation に
混ぜません。

`cloudflare_provider_gap_bridge_mode` の disposable bridge は、Vectorize と Container
についてはこの surface に置き換わります。bridge が今も担うのは container-ready な
Durable Object namespace の bootstrap だけです。D1 migration はどちらの入口の担当でも
ありません。

## 必要な入力

| 入力 | 何か | 必須 |
| --- | --- | --- |
| `--environment` | `integration` / `rehearsal` / `production` | 常に |
| `--outputs` | `tofu output -json` の絶対 path | 常に |
| `--release` | 公開済み `takos.worker-artifact@v3` descriptor の絶対 path | production の `--apply` |
| `--container-image` | digest 固定の agent image | `--release` を渡さないとき |
| `--commit` | HEAD と一致する exact commit | `main` 以外から production を配置するとき |
| `CLOUDFLARE_API_TOKEN` | legacy apply/status lane の account credential | `--status` / `--vectorize` / `--apply` / `--containers` (環境変数のみ) |
| `--cloudflare-api-token-file` | first-install authority phase の account credential | 4 deploy-side first-install operation (repository 外の canonical `0600` file) |
| `--outputs-file` / `--output-digest` | retained staging OpenTofu output と SHA-256 | `--release-apply` / `--release-status` |
| `--release-descriptor-file` | canonical `takos.worker-artifact@v3` | `--release-apply` / `--release-status` |
| `--product-environment staging` | Takos product environment (orchestration の `integration` lane とは別) | `--release-apply` / `--release-status` |
| `--expected-served-version` | 成功した release apply receipt の exact UUID | `--release-status` |

container image は必ず digest 固定です。`registry.cloudflare.com/<account>/takos-agent@sha256:…`
または `docker.io/…@sha256:…` 以外は拒否し、tag 参照も受け付けません。通常は
`--release` の `containerImages.executor` から解決されるので、operator が別途
指定する必要はありません。

first install の runtime secret は operator-private file からこの surface の固定
`--runtime-secrets-install` phase が stdin で投入します。free-form secret 名や command は
受け取らず、account から読み戻すのは名前だけです。詳細は
[ランタイムシークレット](/deploy/runtime-secrets) を参照してください。

## Phase

### `--status` (read-only)

desired と live を突き合わせて JSON を出します。account を変更する command は
issue そのものを拒否します。

- 現在配信中の Worker version と、module output が記録した version
- route と `workers_dev`
- Vectorize index の有無と shape
- Container application と、pin された image digest を持つ数
- Durable Object の pending migration
- runtime secret の名前 (値ではありません)
- 公開 URL の `/health`

`drift` 配列が空なら、`--apply` を止める理由は残っていません。

### `--vectorize`

宣言された index を create-if-absent で用意します。

- 既にあり shape が一致 → `present` (何もしません)
- 無い + `--execute` 無し → `would-create`
- 無い + `--execute` → 作成し、読み戻して shape を確認
- shape が違う → 拒否

shape は `deploy/product-resources.json` の `embeddings` (`VectorIndex`) を
Cloudflare で表したもので、768 次元・cosine 固定です。Vectorize index は後から
次元を変えられず、この surface は index を削除しないので、食い違いは自動で
直さず止まります。

### `--apply`

routine な code/static の lane です。次を順に確かめ、どれか 1 つでも欠ければ
account に触れる前に止まります。

1. production は clean な worktree と `main`、または HEAD と一致する `--commit`
2. production は release descriptor を canonical に parse し、archive を download して
   size と SHA-256 を照合し、`commit` が HEAD と一致すること
3. module output から realized config を生成し、placeholder が 1 つも残らないこと
4. `runtime_secrets_provisioned` が true で、Worker に 5 つの secret が存在すること
5. Vectorize index が product shape で存在すること
6. Durable Object の pending migration が無いこと
   (あれば `--allow-durable-object-migration` を明示するまで拒否)
7. `wrangler deploy --dry-run` が realized config を compile できること

`--execute` を付けたときだけ upload が 1 回走ります。production で release に
束ねられているときは、その release の publication が同じ commit で
`bun run check` を通しているのでその attestation を再利用し、それ以外は
upload の前に gate を 1 回実行します。

upload の後は、新しい version id、binding closure、secret 名、pin された image を
持つ Container application、そして公開 URL を読み戻します。production は
`/health` が 200、`/api/auth/me` が 401 であることまで要求します。

### `--release-apply`

first-install coordinator 専用の closed writer です。既存 surface 名は
`takos-cloudflare-production` のままですが、orchestration lane は `integration`、Takos
product environment は `staging` に固定されます。generic `--outputs` / `--release` /
`--container-image` / `--commit` / realized config、Durable Object migration authority は
受け取りません。

clean checkout の HEAD、`--source-commit`、canonical release descriptor commit を一致させ、regular-file
descriptor の exact bytes digest と physical identity、published archive の size/digest を確認します。archive は repository 外の fresh private custody へ
bounded stream し、compressed 64 MiB / expanded 256 MiB / 20,000 entry を上限に、duplicate、unsafe
path、link、special entry を extraction 前に拒否します。archive、extracted payload、realized config の
bytes と physical identity を seal し、upload 直前/直後に再検証します。retained output が記録した
OpenTofu bootstrap version が現在配信中である場合だけ upload を 1 回行い、新しい served version、
sealed realized config から導く exact non-secret binding closure、別管理の runtime secret 5 名、
Vectorize、direct API の全 cursor page を 2 回一致させた Container application の exact 3-name closure、
各 typed detail の image/health/no-active-rollout、`/health` を読み戻します。成功する v2 result は owner
contract、release tag/descriptor exact bytes digest/archive digest/executor と public-agent image、
account/Worker/public URL、bootstrap/served version、complete inventory evidence を value-free に束ねます。

upload は account/Worker/source/output bytes digest/operation/release descriptor digest から決まる attempt
tag/message を使います。owner-private な target/account+Worker+operation scope の atomic local lease を
absence から exact unique readback まで保持し、stale/foreign lease は steal しません。これは same-host
single-writer fence であり、provider の distributed CAS ではありません。lease 内で direct Worker Versions
API の全 page を 2 回 scan して一致させ、exact attempt が不存在のときだけ
`--strict --containers-rollout immediate` で upload を 1 回実行します。

upload 後も全 page を 2 回 scan し、通常 acknowledgement と lost acknowledgement の両方で exact
tag/message 1 件、pre-inventory からの immutable addition 1 件、current/version-detail の同一 UUID と
tag/message を要求します。page drift、0 件、複数件、foreign concurrent addition/current は exit 3 です。
新 overlay 全体を証明できれば通常の成功 receipt、できなければ exit 3 です。upload の retry や raw provider
output の返却は行いません。`immediate` は Container rollout 完了を意味しないため、complete inventory と
各 application detail の health と `active_rollout_id` の readback が成功条件です。

### `--release-status` (read-only)

成功した `release-apply` receipt の `activated.servedVersion` を exact
`--expected-served-version` として受け取ります。retained bootstrap version と current served
version の差だけを expected release overlay とし、その他の binding/secret/Vectorize/
Container/Durable Object/config/health drift は active result にしません。Container は direct API の全
cursor page を 2 回一致させた exact 3-name closure と各 typed detail を要求します。比較は typed readback
だけで行い、current deployment は structured JSON の単一 100% version に固定します。v2 status は
owner contract、descriptor exact bytes digest、complete Container inventory evidence を返します。legacy
`--status` の `drift` prose や人向け UUID output は parse しません。`--execute` は拒否します。

indeterminate apply は expected version を持たないので、この status に推測値を渡して回復
させません。coordinator は indeterminate のまま停止します。exact CLI と result schema は
[first-install owner contract](/deploy/first-install-owner-contract) が正本です。

### `--containers`

宣言された 3 つの executor class に対して、pin された image digest を持つ
Container application が存在するかを読み取ります。`wrangler.toml` の
`[[containers]]` が宣言の正本で、reconcile は `--apply` の upload が行います。

### `--runtime-secrets-install`

first-install coordinator 用の authority phase です。digest で固定した non-secret module
output から account/Worker を取り、`REQUIRED_RUNTIME_SECRET_NAMES` の 5 file だけを
stdin upload します。各 upload の直後に secret name を authoritative readback し、lost
acknowledgement で新しい値を証明できない場合は停止します。credential/value は argv、raw
log、result に出さず、blind retry もしません。`--execute` が無い場合は fixed plan だけを
返します。

### `--absence-proof` (read-only)

owning OpenTofu destroy 後に retained output artifact を使い、Takos が所有していた Worker /
version / route / domain、D1、KV、R2、Queue、Vectorize、Container application の 22 row を
`absent` / `present` / `indeterminate` で読み戻します。fixed GET 以外を発行せず、resource を
直接削除しません。詳細な result shape は
[first-install owner contract](/deploy/first-install-owner-contract) に固定されています。

## 初回の本番配置

```sh
# 1. 耐久インフラ。Worker identity はここで作られます。
cd deploy/opentofu/cloudflare
tofu init
# runtime_secrets_provisioned = false と
# first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
tofu apply -var-file=opentofu.tfvars
tofu output -json > /operator-private/takos/generation-1-outputs.json

# 2. repository 外の owner-private directory に 5 secret を生成して固定 phase で投入する
cd ../../..
bun run generate:keys -- \
  --env=production \
  --output=/operator-private/takos/runtime-secrets
bun run deploy -- takos-cloudflare-production \
  --runtime-secrets-install \
  --environment production \
  --outputs /operator-private/takos/generation-1-outputs.json \
  --output-digest sha256:<generation-1-outputs の SHA-256> \
  --source-commit <40 桁 commit> \
  --operation-id <coordinator operation id> \
  --runtime-secret-directory /operator-private/takos/runtime-secrets \
  --cloudflare-api-token-file /operator-private/cloudflare/api-token \
  --execute

# 3. inherit binding を有効にして再 apply する
cd deploy/opentofu/cloudflare
# runtime_secrets_provisioned = true、first_install_acknowledgement は空に戻す
tofu apply -var-file=opentofu.tfvars
tofu output -json > /srv/takos/outputs.json
cd ../../..

# 4. Vectorize index (provider が表現できない resource)
bun run deploy -- takos-cloudflare-production --vectorize \
  --environment production --outputs /srv/takos/outputs.json --execute

# 4b. index ができたので Worker に bind する
cd deploy/opentofu/cloudflare
# vector_index_provisioned = true
tofu apply -var-file=opentofu.tfvars
tofu output -json > /srv/takos/outputs.json
cd ../../..

# 5. 差分を読む
bun run deploy -- takos-cloudflare-production --status \
  --environment production --outputs /srv/takos/outputs.json \
  --release /srv/takos/takos-artifact.json

# 6. 初回は Durable Object の chain 全体が pending なので、
#    reviewer が pending list を読んでから明示的に許可する
bun run deploy -- takos-cloudflare-production --apply \
  --environment production --outputs /srv/takos/outputs.json \
  --release /srv/takos/takos-artifact.json \
  --allow-durable-object-migration --execute

# 7. 読み戻し
bun run deploy -- takos-cloudflare-production --status \
  --environment production --outputs /srv/takos/outputs.json \
  --release /srv/takos/takos-artifact.json
bun run deploy -- takos-cloudflare-production --containers \
  --environment production --outputs /srv/takos/outputs.json \
  --release /srv/takos/takos-artifact.json
```

2 回目以降の code deploy は 6 の `--allow-durable-object-migration` を外した形です。
`[[migrations]]` の tag が増えたときだけ、また明示が要ります。

`/srv/takos/takos-artifact.json` は release で公開された descriptor です。GitHub
Release の asset から取得します。

```sh
gh release download v0.12.7 --repo tako0614/takos --pattern takos-artifact.json \
  --dir /srv/takos
```

## release identity との関係

production は release の bytes を配置します。descriptor が指す archive を
download し、size と SHA-256 が record と一致することを確認してから、その
`worker/index.js` と `assets/` を `--no-bundle` で upload します。だから
「今動いているのはどの release か」は commit ではなく tag で答えられます。

integration と rehearsal は worktree から build できます。この 2 つは
`bun run build` の成果物 (`dist/`) を wrangler が bundle します。

## 戻し方

upload の前に、配信中の version id と、それを戻す
`wrangler versions deploy <id>@100%` を出力します。戻せるのは Worker の code
だけです。Durable Object migration、作成済みの Vectorize index、Container
application は forward-only で、version の rollback では戻りません。

## 失敗したとき

exit code が、どちら側で失敗したかを表します。

| exit | 意味 | 次にすること |
| --- | --- | --- |
| 2 | account に触れていない | 表示された条件を満たしてやり直す |
| 3 | upload が届いたか、または readback が確定できない | legacy lane は `--status` で判断する。first-install release apply は内部の 1 回の readback でも証明できなかった状態なので、推測した version で retry/status を行わず停止する |
| 4 | bytes は公開されたが post-condition が失敗 | `--status` で読み戻し、必要なら rollback |

いずれの場合も自動 retry はしません。legacy apply/vectorize lane は provider の stdout と
stderr を診断として出しますが、first-install の runtime-secret/release phase は値を反映し得る
raw output を一切出さず、固定した bounded evidence だけを返します。

## 既知の重なり

`deploy/cloudflare/wrangler.toml` と OpenTofu module はどちらも queue consumer と
cron trigger を宣言します。値は同じですが、後から実行したほうが最終状態になります。
また module 自身も Worker version を持つので、この lane で deploy したあとに
`tofu apply` を実行すると module 側の version が再び配信されます。`--status` は
その差 (`moduleVersion` と `servedVersion`) を drift として表示します。

## 関連ページ

- [セルフホスト概要](/deploy/)
- [ランタイムシークレット](/deploy/runtime-secrets)
- [Release artifact runbook](/deploy/release-artifact)
- [ロールバック](/deploy/rollback)
- [環境と変数](/deploy/environment)
