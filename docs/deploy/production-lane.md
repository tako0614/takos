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
| `CLOUDFLARE_API_TOKEN` | account を選ぶ credential | 常に (環境変数のみ) |

container image は必ず digest 固定です。`registry.cloudflare.com/<account>/takos-agent@sha256:…`
または `docker.io/…@sha256:…` 以外は拒否し、tag 参照も受け付けません。通常は
`--release` の `containerImages.executor` から解決されるので、operator が別途
指定する必要はありません。

runtime secret は operator が `wrangler secret put` で投入します。この surface は
名前だけを読み、値を読みません。詳細は
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

### `--containers`

宣言された 3 つの executor class に対して、pin された image digest を持つ
Container application が存在するかを読み取ります。`wrangler.toml` の
`[[containers]]` が宣言の正本で、reconcile は `--apply` の upload が行います。

## 初回の本番配置

```sh
# 1. 耐久インフラ。Worker identity はここで作られます。
cd deploy/opentofu/cloudflare
tofu init
# runtime_secrets_provisioned = false と
# first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
tofu apply -var-file=opentofu.tfvars

# 2. runtime secret を投入する
cd ../../..
bun run generate:keys
wrangler secret put ENCRYPTION_KEY
wrangler secret put TAKOS_AGENT_START_TOKEN
wrangler secret put TAKOS_INTERNAL_API_SECRET
wrangler secret put PLATFORM_PRIVATE_KEY
wrangler secret put PLATFORM_PUBLIC_KEY

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
| 3 | upload が届いたか不明 | `--status` で権威的に読み戻してから判断する |
| 4 | bytes は公開されたが post-condition が失敗 | `--status` で読み戻し、必要なら rollback |

いずれの場合も自動 retry はしません。provider の stdout と stderr をそのまま出します。

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
