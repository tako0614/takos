# アップグレード / ロールバック / エクスポート

> このページでわかること:
> インストール済みアプリの更新、巻き戻し、dedicated materialize、export / import の扱い。

## 1. Upgrade

AppInstallation の source revision を新しい ref に進める Accounts 台帳操作。同じ
source git URL 配下の tag / commit を pin し直し、必要に応じて binding / grant
の diff をユーザに承認させてから `installation.upgraded` event を記録する。

### 1.1 CLI

```bash
takosumi-git upgrade inst_abc --ref v1.2.4 --accounts-url https://accounts.example.com
```

`--ref` には **immutable な tag または commit SHA** を指定する。`main` 等の
mutable-looking ref は `takosumi-git` が apply 前に拒否する。

### 1.2 流れ

```txt
1. new ref fetch       (takosumi-git が source repo から指定 ref を pin)
2. app.yml parse       (.takosumi/app.yml を parse し metadata / bindings 抽出)
3. revision preview    (current source / digest と next source / digest の diff)
4. permission diff     (requestedGrants / requestedBindings の add/remove)
5. binding review      (database / object-store / domain 等の binding-level review)
6. approve             (UI / CLI で permissionDigest と costAck を ack)
7. apply               (Accounts が source pin / digest を更新し ledger event を append)
```

current implementation は ledger revision primitive です。kernel rollout / watcher
readiness / provider worker rollback は operator 側の実行系が接続する領域であり、
このページでは「台帳上の source pin と event が更新される」ことを current
contract として扱います。

### 1.3 UI 例

```txt
Upgrade Takos v1.2.3 → v1.2.4

Source:
  github.com/takos/takos
  ref: v1.2.4
  commit: 9d8e2...

Changes:
  - api image updated
  - web image updated
  - new permission: none
  - binding review: database.postgres changed

Estimated cost change:
  no change

[Cancel]                                              [Upgrade]
```

permission diff が **add** を含む場合は、UI が
[Install preview](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md#post-v1installpreview)
と同等の permission gate を再度通すことを要求する (新 `permissionDigest` の ack
必須)。

### 1.4 channel policy

`.takosumi/app.yml` の `upgrade.policy`:

```yaml
upgrade:
  policy:
    securityPatch: automatic
    minor: ask
    major: ask
```

- `automatic`: ユーザ ack なしで operator install service が自動 upgrade
- `ask`: 必ず UI / CLI で ack
- `pin`: 自動 upgrade を一切行わない

`securityPatch` channel での自動 upgrade は **permission diff が空、かつ costAck
不要** な場合のみ実行される。

## 2. Rollback

直前 (または任意の過去 ref) の AppInstallation 状態に戻す操作。

### 2.1 CLI

```bash
takosumi-git rollback inst_abc --to v1.2.3
```

`--to` の代わりに `--compiled-manifest-digest sha256:...` も指定可能。
指定された target が当該 installation の `installation.deployed` event 履歴に
存在しない場合は `422`。

### 2.2 必要保存物

current Accounts 台帳は、upgrade / rollback の revision event に次を記録する:

- source ref / source commit
- `appManifestDigest`
- `compiledManifestDigest` (ある場合)
- requested binding / grant の snapshot
- `permissionDigest` / `costAck` の confirm evidence

データそのもの (Postgres rows / blob objects) は **rollback で巻き戻されない**。
current rollback は ledger source pointer の revision として扱う。artifact retention
や database restore marker の世代保持は operator policy / provider worker evidence
の領域であり、このページでは current guarantee としては扱わない。

### 2.3 制限事項

- provider data copy / schema migration の巻き戻しは rollback の current guarantee
  ではない
- `database.postgres@v1` / `object-store.s3-compatible@v1` / `domain.http@v1`
  の変更は binding-level review と user approval の対象
- production-grade artifact retention / rollback drill は managed offering
  launch-readiness evidence 側で扱う

preview は binding / grant / cost の差分を示し、必要な approval を要求する。

## 3. Export bundle

AppInstallation を取り出してセルフホストするための bundle を生成します。

current implementation は bundle / API / archive / restorer bridge までです。data dump は provider が export data
provider / restorer を構成した場合のみ含まれ、production full live dump / restore は current guarantee ではありません。

Export は「source pin と bundle metadata を持ち出し、target で新しい identity を生成する」操作です:

- ✅ 保持される: source commit pin / app manifest digest / compiled manifest
  digest / binding template / provider 構成済みの場合のみ data dump (DB / blobs / memory / profiles)
- ⚠ target で再生成される: OIDC client (新 `client_id` / `client_secret`)、
  pairwise subject (新 issuer で再計算)、InstallationEvent ledger
  (新 chain)、launch token の発行 context
- ❌ 移植されない: instance を跨ぐ audit chain、source instance での
  access history と target の continuity を link する protocol 手段

user の identity は source / target instance で別 entity として扱われ、
link は持ちません。これは
[per-instance scope の trade-off](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/design-principles.md#7-per-instance-scope-sovereignty-trade-off)
の直接の帰結です。federation が必要なユースケースは app-layer (例: yurucommu
の ActivityPub) で対応します。

### 3.1 CLI

```bash
takosumi-git export inst_abc --output takos-export.tar.zst
```

Install API 経由なら
[`POST /v1/installations/{id}/export`](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md#_5-post-v1-installations-id-export)。

### 3.2 Bundle 構造 {#export-bundle}

bundle (tar.zst) を展開すると、次の directory tree になる:

```txt
takos-export/
  bundle.json
  installation.json
  source.json
  app.yml
  manifest.compiled.yml
  data/
    postgres.dump
    blobs/
    memory.jsonl
    profiles.jsonl
  bindings/
    template.yml
    identity.oidc.yml
    database.postgres.yml
    object-store.s3-compatible.yml
    domain.http.yml
    deploy-intent.gitops.yml
    install-launch-token.yml
  docs/
    restore.md
```

`bundle.json` は Accounts API が直接受け取る machine-readable payload
(`takosumi.accounts.installation-export-bundle@v1`)。`takosumi-git import
./takos-export.tar.zst`
はこの file を読んで `POST /v1/installations/import` に送る。`installation.json`
/ `source.json` / `bindings/*.yml` は restore review と手動復旧用の public
projection。

`installation.json` 例:

```json
{
  "installationId": "inst_abc",
  "appId": "example.notes",
  "source": {
    "git": "https://github.com/example/notes-app",
    "ref": "v1.2.3",
    "commit": "7f3c9..."
  },
  "digests": {
    "appManifest": "sha256:...",
    "compiledManifest": "sha256:..."
  }
}
```

`bindings/*.yml` には各 binding kind の **provisioning templates** が 入る
(secret material は **含まない**; self-host 側の Takosumi Accounts が再
materialize する)。 `install-launch-token@v1` は source instance の `publicKey`
/ `kid` を active config として持ち出さず、target Accounts instance が issuer /
key / consume ledger を 再発行する。bundle に入るのは audience / consume path
などの non-secret intent だけです。

`data/` の内容は export request の `scope.data` で制御される (`postgres` /
`blobs` / `memory` / `profiles`)。

Accounts 内部の payload kind は
`takosumi.accounts.installation-export-bundle@v1` です。

### 3.3 Encryption

bundle は default で **age 暗号化**される (`POST /export` の
`encryption.method: "age"`、`recipients: ["age1..."]`)。`none` も指定可能だが
非推奨。

## 4. Self-host import

export bundle (または直接 Git clone) を、自前の takosumi インスタンスに install
する。

### 4.1 CLI

```bash
takosumi-git import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

`--to` は **self-host 側の Takosumi Accounts (= account plane)** の base URL。
OIDC issuer は import 先の Takosumi Accounts が `operator.identity.oidc` として
発行する。Keycloak / Authentik / Auth0 などはその Accounts instance の upstream
IdP として接続し、AppInstallation の issuer を直接外部 IdP に差し替えない。
import planner は bundle 内の source issuer を target issuer に置換し、revoked
grant を import request から除外する。secret material は移さず、self-host 側で
再発行する。Accounts API では `POST /v1/installations/import` が JSON bundle
payload を受け取り、target Accounts instance の AppInstallation として登録する。
current CLI bridge として `takosumi-git import ./takos-export.tar.zst` は
archive 内の `takos-export/bundle.json` を同 endpoint に送る。tar.zst
writer、age wrapped tar.zst import、`--restore-data` による configured data
restorer への data entries 受け渡しは実装済み。 ただし production provider
ごとの full live dump / restore は provider adapter の責務として追加実装する。

```bash
takosumi-git import ./takos-export.bundle.json \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

bundle ではなく Git URL から直接 install する経路も同等にサポートされる:

```bash
takosumi-git install https://github.com/example/my-app --ref v1.2.3 \
  --to https://my-takosumi.example.com
```

### 4.2 OIDC issuer の再解決

self-host 側では、AppInstallation の `identity.oidc@v1` binding は
`operator.identity.oidc` を self-host Takosumi Accounts に resolve して
`issuerUrl` を得ます。既存 IdP は Takosumi Accounts の upstream として接続し、
Takos runtime が AppInstallation ledger を迂回して直接外部 issuer を consume
する形にはしません。

| issuer の例                                       | 用途                                         |
| ------------------------------------------------- | -------------------------------------------- |
| `operator.identity.oidc` から resolve した issuer | managed / self-host Takosumi Accounts        |
| Keycloak / Authentik / Auth0 / Clerk              | Takosumi Accounts の upstream IdP として接続 |

issuer 切替時の制約:

- issuer は OIDC Discovery (`/.well-known/openid-configuration`) を返す必要が
  ある
- `pairwise` subject mode を要求する場合は issuer 側で `subject_types_supported`
  が `pairwise` を含む必要がある (含まなければ `public` に fallback、ただし app
  間 user tracking 防御は弱まる)
- export 時の `pairwiseSubject` は **新 issuer では再計算される**ため、
  installation 内の Takos profile レコードは新 subject に再 mapping される。
  詳細は self-host 側
  [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  docs を参照

### 4.3 Import 後の確認

import 完了後、以下が動作することを確認する:

1. Takos の `/auth/oidc/login` から新 issuer での login が完了する
2. `/auth/oidc/callback` で profile が新 `externalSubject` に再 mapping
   されている
3. `data/` の Postgres / blobs / memory が import されている
4. `domain.http@v1` の hostname が新 self-host 環境で reachable

## 5. lifecycle 全体図

図中の `upgrading` / `rolling-back` / `materializing` / `exporting` /
`uninstalling` は public `installation.status` ではなく、operation metadata と
InstallationEvent payload 上の transitional phase hint です。外部公開 status は
canonical 5 public statuses (`installing` / `ready` / `failed` / `suspended` /
`exported`) に固定されます。

```txt
install ──► ready ──┬─► upgrading ──► ready (new ref)
                    │       │
                    │       └► upgrade-failed → ready (previous ref)
                    │
                    ├─► rolling-back ──► ready (previous ref)
                    │
                    ├─► materializing ──► ready (mode=dedicated)
                    │       │
                    │       └► materialize-failed → ready (previous mode)
                    │
                    ├─► exporting ──► exported
                    │
                    └─► uninstalling ──► deleted
```

各遷移は
[`InstallationEvent`](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
として append-only に記録される。

## 次に読むページ

- [Install API](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md)
  — upgrade / rollback / export を駆動 する REST endpoint
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
  — `materialize` で遷移する shared-cell / dedicated / self-hosted の比較
- [AppInstallation 台帳](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
  — 過去世代を保存する record と event ledger
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
  — 各 binding の export 時の 扱い (template / secret 除外)
- [Install paths](/apps/install-paths) — 3 path のうち self-host への遷移
