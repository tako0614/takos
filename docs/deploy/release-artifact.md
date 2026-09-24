# Takos release artifact の runbook

この runbook が扱うのは Takos 所有の release artifact です。Worker archive、
`takos-artifact.json`、digest で固定された `takos-agent` image を、対象の
Cloudflare registry と公開 GHCR の両方へ公開します。Takosumi はこれらの成果物を
利用しますが、公開の権限は持ちません。ここで公開するのは配布バイトだけであり、
Capsule の plan / apply / destroy の lifecycle 操作の権限は Takosumi だけが持ちます。
公開済みの v0.12.7 descriptor は変更不可のまま残り、この移行後のリリースは
Takos 所有の `takos-artifact.json` v3 descriptor を使います。

入口は `bun run deploy -- takos-release-artifact` です。両フェーズとも
`--execute` がない限り read-only です。provider の出力や secret の値は
evidence に記録しません。

## 前提条件

- `HEAD`、`origin/main`、push 済みの `origin` の main ref が一致する、
  clean な `main` checkout で作業します。Takos では `assume-unchanged` や
  `skip-worktree` の index エントリを使えません。release entrypoint は
  release の入力を読む前に、追跡された全ファイルの物理的な型・実行 bit・
  blob バイト・symlink 先を `HEAD` の tree と独立に比較し、最初の prepare
  push または publish の作成操作の直前にも同じ証明をやり直します。
- ビルドは clean な Takos checkout だけから行います。portable gate と release
  prepare は Takosumi の checkout、composition pin、sibling の source tree を
  必要としません。Takosumi は公開済みのバイトを汎用の release-artifact
  contract 経由で利用します。
- package version をそのまま release identity と tag (`v<package version>`)
  に使います。同じリリースに別名や 2 つ目の tag を作らず、既存 tag を
  張り替えず、既存の package-version tag を再利用もしません。Worker archive
  のバイトは独立に content-addressed で、後の package version で byte 一致に
  なることがありますが、それで release tag を共用できるわけではありません。
- 正の Worker artifact descriptor が、ビルドしたバイトと同じ tag、GitHub
  archive URL、archive SHA-256、size、commit を指すことを必須にします。
  descriptor がそれらを囲んでいなければ、prepare は最初の registry push 前に
  失敗します。

release identity は package-version tag とその descriptor であり、Worker
archive のバイトが以前の version と byte 一致でも変わりません。tag、URL、
digest を同期させる source tree 内の第二の写しはありません。以前
`worker_release_tag`、`worker_artifact_url`、`worker_artifact_sha256` の
既定値を持っていた廃止済みの Provider 1.x tree は無くなったため、リリースは
version を 1 つ上げるだけで、digest のみの pin commit はありません。

- Wrangler の設定、Cloudflare account-id ファイル、API-token ファイル、
  出力ディレクトリ、evidence ファイルはリポジトリの外に置きます。
  operator ディレクトリは `0700`、account / token ファイルは `0600`
  にします。
- 絶対パスを使います。account-id ファイルには 32 文字の小文字 16 進の
  account id を 1 つだけ書きます。

private な作業領域を用意します。例:

```sh
private=/var/lib/takos/release-artifacts/v0.12.7
mkdir -p "$private"
chmod 700 "$private"
chmod 600 /var/lib/takos/operator/cloudflare-account-id
chmod 600 /var/lib/takos/operator/cloudflare-api-token
```

## Prepare

まず `--execute` なしで同じコマンドを 1 回実行します。identity と path を
検査し、ビルド・image の push・tag の作成・output / evidence path の書き込みを
せずに plan を返します。

```sh
bun run deploy -- takos-release-artifact prepare \
  --tag v0.12.7 \
  --config /absolute/path/to/deploy/cloudflare/wrangler.toml \
  --account-id-file /var/lib/takos/operator/cloudflare-account-id \
  --cloudflare-api-token-file /var/lib/takos/operator/cloudflare-api-token \
  --output-dir "$private/assets" \
  --evidence "$private/prepare.json"
```

plan を確認したら、同じコマンドに `--execute` を付けて再実行します。
prepare は既存の output / evidence path を拒否します。agent image を 1 回
ビルドし、権威でない nonce tag で両 registry に同じバイトを upload し、
読み戻した変更不可の digest 参照を記録し、正確な Worker asset をビルドして、
`prepare.json` を mode `0600` で書きます。release identity になるのは
digest 参照だけで、upload tag は descriptor に入りません。

prepare は最初の remote push の前に portable gate を全部やり直し、すべての
build / smoke の後、registry 変更の直前に Takos の物理 `HEAD`-tree 証明を
繰り返します。Worker descriptor と private な prepare evidence が束縛するのは
Takos の release commit、archive、image の identity だけです。

prepare は Worker archive を正の archive metadata でビルドします。
owner / group `0`、timestamp `0`、ディレクトリ `0755`、Worker / static
ファイル `0644` で、ビルドの umask や source のファイルモードに依存しません。
コピーするのは Wrangler の JavaScript entrypoint だけで、source map や
checkout のパスは入りません。archive の定点テストは、異なる絶対 checkout
root、`SOURCE_DATE_EPOCH` の値、process umask `022` / `077` を
カバーします。archive 内のファイルに実行ファイルの契約はありません。
prepare はその正確なバイトを Wrangler local workerd で起動し、実際の Takos
`/health` JSON、認証なしの `/api/auth/me` 境界が JSON の `401` を返すこと、
`/.well-known/takosumi` の product discovery 応答 (`/api/v1` を含む) を
要求してから、bounded な smoke evidence を記録します。image digest の
readback 後にビルドされる最終 archive は、この preflight archive と byte
一致しなければなりません。

各 registry push は、一時的な private ビルドディレクトリ配下の独自の
`DOCKER_CONFIG` で実行します。コマンドは operator の既定の Docker config を
使わず変更もしません。prepare は両 registry の manifest を読み戻し、bounded
な内容 identity の evidence (config digest と順序付き layer digest) だけを
記録します。Cloudflare と公開 GHCR の identity は一致する必要があり、
不一致なら artifact を公開する前にリリースを止めます。

## Publish

まず prepare の evidence を使って publish を dry-run します。evidence は
上書きしないため、試行ごとに新しい publish evidence path を使います。

```sh
bun run deploy -- takos-release-artifact publish \
  --tag v0.12.7 \
  --prepare-evidence "$private/prepare.json" \
  --evidence "$private/publish.json"
```

plan を承認したら、そのコマンドに `--execute` を付けます。publish は
まず tag と GitHub Release の identity が両方とも存在しないことを確認し、
prepare 済みの公開 GHCR image を匿名で読み直し、正確な archive の smoke と
descriptor / source の検証を済ませてから、create-only の GitHub Release 呼び出し
1 回の直前に、tag と Release の不存在をもう一度読み直します。その最終の
不存在確認のあとで初めて、公開試行の乱数 identity を発行し、create リクエストの
変更不可な release notes に束縛します。draft、upload、edit、update、delete、
force、adoption、retry の経路はありません。

作成が始まったあと、publish は tag commit と変更不可の非 draft Release を
権威的に読み直し、正確な title、対象 commit、試行 identity、API の asset
digest と名前を要求し、3 つの asset をすべてダウンロードしてバイトを再度
ハッシュします。それから、ダウンロードした Worker archive を Wrangler local
workerd で起動し、同じ Takos の health と product discovery の API path を
試します。この完全な readback だけが `publish.json` を生成でき、そこには
create コマンドが通常どおり ack されたか、正確な lost-acknowledgment の
readback だけから回復したかも記録されます。

## Evidence と digest の readback

`prepare.json`、`publish.json`、asset のディレクトリは checkout の外に
置きます。JSON は operator-private の release evidence として扱います。中身は
commit、package / tag、account id、path、asset の digest、image 参照、公開の
公開試行 identity で、token や provider コマンドの出力は入りません。

prepare の記録は、Takos release closure、3 つの asset digest、Cloudflare
registry 参照、公開 GHCR 参照、2 つの registry 内容 identity の出所です。
identity は `configDigest` と順序付き `layerDigests` だけを持ち、すべて
`sha256:<64 hex>` の形です。credential や provider コマンドの出力は入りません。
prepare は匿名の GHCR readback も行い、認証済み readback と一致することを
要求します。独立した検査が必要なら private なファイルに対して実行し、結果を
記録値と比較してください。evidence を手作業で編集した写しに置き換えては
いけません。

publish は、prepare の field どうしの一致を descriptor の証明として扱いません。
release tag、GitHub Release、image provider の読み取り前と、単一の create-only
変更の直前に、prepare 済みの各 asset を bounded・private・operator 所有の物理
ファイルとして symlink をたどらずに開きます。archive バイトをハッシュして
サイズを測り、正の checksum を確かめ、正の descriptor を欠落・未知・余分な
field のない形で厳密に parse します。descriptor は現在の Takos commit、
package version / tag、portable module の release 入力、物理 archive の
digest / size、release URL、prepare 済み image identity を独立に囲んでいる
必要があります。その再計算した正の digest と size は、prepare evidence の
descriptor レコードと asset レコードの両方と一致しなければなりません。

## 回復と上書き禁止

- image push のあとで中断した prepare は、権威でない upload tag を残すことが
  あります。versioned の Git や GitHub Release の identity は消費していない
  ので、失敗を調べ、tag / release が作られていないことを確認してからだけ
  再実行してください。
- create-only の公開が始まったあとは、自動で再実行してはいけません。
  コマンドエラーが lost acknowledgment であると言えるのは、最終の不存在確認の
  あとに create プロセスが実際に起動した場合だけです。entrypoint が成功を
  認めるのは、権威ある tag、変更不可の Release、その確認後に発行した予測
  不能な試行 identity、ダウンロードした正確なバイト、Takos runtime smoke が
  すべて prepare 済み identity を囲むときだけです。既存または競合する
  Release はその試行 identity を持てず、採用もしません。不完全な readback は
  不定であり、retry や採用ではなく operator の調査が必要です。
- 既存の tag や Release、競合する asset、digest や runtime の不一致は、
  すべて即停止です。既存の identity を force-push、delete、replace、upload、
  edit してはいけません。
- 公開済みの tag、image tag、release asset は変更不可の identity として
  扱います。修正は新しい version と tag であり、それらのバイトをその場で
  巻き戻す方法はありません。
