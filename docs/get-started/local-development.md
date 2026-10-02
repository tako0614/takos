# ローカル開発ガイド

> このページでわかること: Takos
> のローカル開発環境をセットアップして起動する方法。

Docker Compose を使って、Takos の全サービスをローカルで動かします。

## 必要なもの

- Linux（必須native回帰試験は `/proc` で実workerdの実行ファイルを確認するため、現在Linux hostで検証）
- Bun 1.3.14（repo gate / Worker build）
- Node.js 26.1.0（native D1 回帰試験の Miniflare host、CI と同じ固定版）
- Python3.9以降とpidfd対応Linux kernel（portableなprocess停止回帰と追加Container試験）
- Docker (current stable)
- Docker Compose V2

## セットアップ

```bash
cd takos
bun run check
cp .env.local.example .env.local
```

## 起動・停止

```bash
# 起動
docker compose --env-file .env.local -f compose.local.yml up --build

# ログを見る
docker compose --env-file .env.local -f compose.local.yml logs -f

# 停止
docker compose --env-file .env.local -f compose.local.yml down
```

バックグラウンドで起動したい場合は `-d` を付けます:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## 動作確認

```bash
bun run check          # format / lint / types / tests / Rust / build の全gate
bun run local:config   # compose 設定のレンダリング確認
bun run local:e2e      # public API -> queue -> agent container の実 Run E2E
bun run validate:agent-local-proof # component + 上記の実 Run 証跡
```

`local:e2e` は通常の `compose.local.yml` に検証専用 override を重ね、ローカル OIDC issuer、決定的な
OpenAI-compatible stub、executor bridge を一時的に起動します。外部 API key は不要です。公開 API から
Workspace / Thread / user message / Run を作成し、Run が `completed` になるまで status、output、event、assistant message を
poll します。health check だけでは成功になりません。

Docker daemon を使えない場合、`validate:agent-local-proof` は live proof を成功扱いにせず、JSON の
`local-compose-public-api-run` を `unavailable` として理由を表示します。Docker を使わない component 確認だけを明示的に
行う場合は `bun run validate:agent-local-proof:components` を使えますが、出力の `complete` は `false` であり実 Run 証跡には
なりません。

### Native D1 の回帰試験

`bun run check` の portable tests は、installed Miniflare/workerd を別の Node process
で実行する必須試験を含みます。単独で実行する場合:

```bash
bun test scripts/prove-run-usage-native.test.ts
```

Worker の bundle は実行中の Bun で作成し、compatibility date / flags は
`deploy/cloudflare/wrangler.toml` を読みます。空の native D1 に production の全embedded
migrationを既定budgetで適用し、ledger / checksum、終端Runとusage witnessの同時rollback、
同一completionの重複防止、usage batchのrollbackとnative DO置換後のcold retryを検証します。
configured owner / OIDC / private Workspaceのauthorityが不変であることも確認します。
schemaは最大2回の明示したadmission requestで確認します。初回がpendingなら、ledgerが
正しいprefixでclaimを解放したことを確認し、返された5秒のretry hintを待って1回だけ継続します。
初回の状態と継続前後のledgerを記録し、全migrationがreadyになってからcached再入場を確認します。
native runtimeが無い場合、failed / applying、進捗なし、2回目もpendingなら失敗し、
skipやstorage置換はしません。各migration budgetと内外の試験期限は変えません。

各試験の状態は `tmp/native-run-usage-proof/` の新規directoryに隔離します。内側70秒、
process / stdout / stderr全体75秒の期限を設け、所有するprocess groupを終了確認します。
成功時は実runtime identityとsource / bundle / input hashesを完全reportへ保持し、
receiptの書込みが成功してからfixtureを削除します。
失敗時は同directoryに診断を保持し、pathを表示します。

HTTP schema proofとusage proofは、全assertionsと所有process cleanupが通った後で、
完全なJSON文字列・UTF8 byte数・SHA256を `tmp/native-proof-reports/` の新規exclusive
envelopeへ保持します。fsyncと全文readbackが成功してから、stdoutへ
`nativeProofReportRetained` のJSON receiptを1行だけ出します。receiptはfamily・SHA256・
byte数・相対保存先を含み、JSON escaping後のUTF8行全体を2048 bytes以内に制限します。
書込みの完了とbyte数を確認し、短い書込み・失敗・5秒の期限超過は試験を失敗にします。
完全なreportを大量のstdout recordsへ二重出力しません。出力失敗時もenvelopeと元fixtureを残します。

CIはgateのstdoutをlocal logへ記録し、gate成功後に正確な2familyのreceiptと対応する
regular envelope file・全文SHA256・byte数・passed結果を照合します。欠落・重複・pathの
不一致・symlink escapeは失敗です。このdirectoryのJSONだけを
`native-proof-reports-<tested-merge-commit>` artifactとして3日間保持します。
保持失敗や既存fileの再利用も失敗とし、元fixtureを残します。
SQL databaseやfixture credentialsをartifactへ含めません。同じCI runのartifactを読み戻し、
envelopeの `serializedReport` のUTF8 byte数とSHA256を照合してからparseし、runtime /
source / bundle / input hashesを検証します。短いreceiptだけでは全文の証拠になりません。
過去のchunkログに欠けがあっても別runで補完しません。

これはlocal native D1 / DO / R2の証拠です。hosted backendのalarm / quota / concurrency、
native backendとcompiled process / Containerの結合、実owner導入や全instance
backup / restoreは別に検証します。

## ローカルで起動するサービス

| サービス       | 役割                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `takos-worker` | Web UI / API / queue / scheduled Worker / Git ホスティング (worker-native Smart HTTP) |
| `takos-agent`  | エージェント実行                                                                      |
| `takosumi`     | デプロイエンジン                                                                      |
| `postgres`     | データベース                                                                          |
| `redis`        | キュー / キャッシュ                                                                   |

Takos product の public/control Worker は `takos-worker` 1 つです。local / self-host
stack で container callback helper endpoint が見える場合も、これは container
接続用の実装 detail であり、追加の Takos product Worker 境界ではありません。
`local:e2e` の `agent-proof-runtime` も検証時だけ使う harness で、通常の local stack や product service には含めません。

## 個別のプロセスを起動する

Docker Compose を使わず個別に起動したい場合は、Takos repo 内の source owner から起動します。

- `src/worker/` / `src/worker/server/routes/` — Takos Worker、worker-native Git Smart HTTP を含む (`bun run dev`)
- `web/` — browser UI (`bun run dev:web`)
- `containers/agent/` —エージェント (`cd containers/agent && cargo run`)
- `../takosumi/` —デプロイエンジン

## 注意

ローカル環境は本番環境と完全に同一ではありません。プロバイダー固有の挙動については
[デプロイ / セルフホスト](/deploy/) を確認してください。

## Native production HTTP schema proof

The portable gate also runs `scripts/prove-http-schema-native.test.ts`. It bundles the canonical
Cloudflare entrypoint, runs it in an isolated Node26.1 / installed Miniflare process, and sends a
real HTTP request to the anonymous `/.well-known/takos` route using deployment compatibility flags.
A fresh fixture-held migration lease must produce the production503 and Retry-After response
without applying migrations. After releasing that fixture claim, at most two ordinary HTTP
requests must reach the full embedded checksum ledger and discovery200; a pending response must
advance the same prefix and honor the retry hint. Ready re-entry must leave the ledger and lock
unchanged. The Linux host and process cleanup requirements of the native usage proof also apply.

This is local native HTTP admission over a fresh database. It does not prove hosted readiness,
populated migrations, owner login or Container composition. Failure fixtures are retained;
only new successful fixture state is removed. The production migration budget and test deadlines
are not overridden, and no operator migration endpoint is used.

## Native cron / Queue のRun復旧回帰

次の試験は、隔離したNode / Miniflareで正規WorkerのscheduledとQueue entrypointを実行します。

```bash
bun test ./scripts/prove-stale-run-native.test.ts
```

新しいnative D1へ全migrationを適用し、stale Runの再配送と新しいleaseによるclaim、
fresh / terminal Runの保持、重複配送、保存済みmodelとcheckpoint・累積usageの保持、
以前のpending operationの再実行拒否を確認します。configured instance ownerとprivate
Workspaceの認可も正規の経路を通します。

stale時刻は試験用データで与え、実際の5分の検出待ち時間を証明しません。executor
transportは試験用の受理応答であり、実Containerの起動・復旧とは別の証拠です。
raw状態と結果はこのcheckoutの新しい `tmp/native-stale-run-proof/` 内に保存し、
既存stateを再利用しません。hosted Queueやwhole-workerd restart、実ownerのログイン、
全instance restoreは別途確認が必要です。

## 実Containerのcheckpoint・使用量復旧試験

`validate:agent-native-container-recovery` は明示的に実行する追加試験です。Linux、Node.js
26.1.0、Bun1.3.14、pidfd対応のPython3.9以降／Linux kernel、ローカルDocker daemon、検証するagentのOCI layoutと事前load済みimage、
digestで固定した事前load済みproxy imageが必要です。imageのbuild、pull、load、tag操作は行いません。
callback hostはDocker Containerから到達できるローカルinterfaceを指定します。

```bash
node scripts/prove-agent-container-native-recovery.mjs \
  --layout /absolute/path/to/oci-layout \
  --reference your-oci-tag \
  --source-commit <full-40-hex-image-source-commit> \
  --expected-manifest-digest sha256:<64-hex-manifest-digest> \
  --image your-preloaded-agent:tag \
  --sidecar-image your-preloaded-proxy@sha256:<64-hex-digest> \
  --bun /absolute/path/to/bun \
  --output-dir "$PWD/tmp/native-container-recovery-proof/fresh-trial-name" \
  --callback-host 172.17.0.1 --listen-host 172.17.0.1 --port 40123
```

placeholderは実値に置き換えます。outputはこのcheckoutの専用base直下にある新規directoryに限り、
既存directoryや別checkoutへは書き込みません。OCI manifest/config/layer/diff IDとDocker image identityを
照合し、Workerは実Wranglerのcompatibility設定と全embedded migrationsからbuildします。
Docker image IDとOCI config digestを同一視せず、manifestの対応と実行設定・diff IDを別に照合します
（[Docker containerd実装](https://github.com/moby/moby/blob/master/daemon/containerd/image_inspect.go)）。
imageにrevision labelが無ければsource commitはoperatorが指定した情報として記録し、
実行したWorkerのcommit・dirty状態・source/bundle/runtimeのhashと区別します。

同じRunのtool成功ACK喪失、実Container交換、pending checkpoint再送、重複effect防止、
両agent停止後の最初の使用量投影、成功usage ACK喪失、実due時刻でのcold retry、idleを検証します。
Container.destroyの実ACKと物理identityを確認し、残るproxyはこの試験で新規作成した
同じRun/DO/imageのIDだけを再inspectして停止します。既存Containerを保持し、所有する
process groupの終了、source/runtime不変、厳格な数量・authority照合まで成功条件に含めます。
プロセス停止はstart ticksとsessionを再照合したpidfdへ送信し、数値PGIDへのsignalは使いません。

内側320秒・外側350秒でnative試験を制限し、成功・失敗ともにraw log、native D1/DO/R2状態、
`supervisor-result.json`と`native/result.json`を保持します。未導入runtime、試験・cleanupの失敗、
期限超過は非zero終了になり、mockへのfallbackやskipによって成功にはしません。
Dockerを伴う試験は通常のportable gateには追加していません。

これはfixture限定のlease CASによるローカル復旧の証拠です。production cron/Queueによる
stale Run回収、whole workerd restart、hosted OIDC/MFA、公開imageのprovenance、Host lifecycle、
全instanceの一貫したbackup/restoreは別の検証が必要です。
