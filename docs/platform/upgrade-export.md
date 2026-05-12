# Upgrade / Rollback / Export

Installable App Model における AppInstallation の **lifecycle 後半** — upgrade / rollback / export bundle / self-host
import — を扱うページです。

## 1. Upgrade

AppInstallation の `sourceRef` を新しい ref に進める操作。同じ source git URL 配下の新しい tag / commit を pin
し直し、必要に応じて binding / grant の diff をユーザに承認させてから kernel deploy を更新する。

### 1.1 CLI

```bash
takosumi-git upgrade inst_abc --ref v1.2.4
```

`--ref` には **immutable な tag または commit SHA** を指定する。`main` 等の mutable ref は `400 mutable-ref-rejected`
で拒否される。

### 1.2 流れ

```txt
1. new ref fetch       (takosumi-git が source repo から指定 ref を pin)
2. app.yml parse       (.takosumi/app.yml を parse し metadata / bindings 抽出)
3. manifest diff       (旧 compiledManifestDigest と新 manifest の diff)
4. permission diff     (requestedGrants / requestedBindings の add/remove)
5. migration plan      (database schema migration / bucket re-provision 等)
6. approve             (UI / CLI で permissionDigest と costAck を ack)
7. apply               (kernel に新 compiled manifest を apply、watcher が ready 待ち)
```

`apply` 段階で失敗した場合は `installation.upgrade-failed` event が発火し、 status は `ready` (旧 ref のまま) に
rollback される。

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
  - database migration: yes (3 statements)

Estimated cost change:
  no change

[Cancel]                                              [Upgrade]
```

permission diff が **add** を含む場合は、UI が
[Install preview](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md#post-v1installpreview)
と同等の permission gate を再度通すことを要求する (新 `permissionDigest` の ack 必須)。

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

`securityPatch` channel での自動 upgrade は **permission diff が空、かつ costAck 不要** な場合のみ実行される。

## 2. Rollback

直前 (または任意の過去 ref) の AppInstallation 状態に戻す操作。

### 2.1 CLI

```bash
takosumi-git rollback inst_abc --to v1.2.3
```

`--to` の代わりに `--compiled-manifest-digest sha256:...` も指定可能。 指定された target が当該 installation の
`installation.deployed` event 履歴に 存在しない場合は `422`。

### 2.2 必要保存物

rollback を成立させるために、AppInstallation は次を **過去 N 世代分** 保存する (default N=3、operator plan で増減):

- 過去の `sourceCommit`
- 過去の `compiledManifestDigest`
- 過去の artifact (image digest)
- migration checkpoint (database schema を巻き戻すための forward-only ledger checkpoint)

データそのもの (Postgres rows / blob objects) は **rollback で巻き戻されない**。 schema migration の forward-only
性質を尊重するため、rollback は "manifest pointer の swap" として表現される。

### 2.3 制限事項

- `database.postgres@v1` extension の追加は forward-only (rollback 後も extension は残る)
- `object-store.s3-compatible@v1` の `encryption.mode` 変更は再 provision を 伴うため rollback 不能 (新 bucket を作って
  migrate するため)
- `domain.http@v1` の `hostname` 変更も rollback 不能

これらの制限は upgrade 前の preview に warning として表示される。

## 3. Export bundle

AppInstallation を **完全に取り出して self-host する** ための bundle 生成。 ユーザの "退出する権利"
を機能として提供する。

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

`bundle.json` は Accounts API が直接受け取る canonical machine-readable payload
(`takosumi.accounts.installation-export-bundle@v1`)。`takosumi-git import
./takos-export.tar.zst` はこの file を読んで
`POST /v1/installations/import` に送る。`installation.json` / `source.json` / `bindings/*.yml` は restore review
と手動復旧用の public projection。

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

`bindings/*.yml` には各 binding kind の **provisioning templates** が 入る (secret material は **含まない**; self-host
側の Takosumi Accounts が再 materialize する)。 `install-launch-token@v1` は source instance の `publicKey` / `kid` を
active config として持ち出さず、target Accounts instance が issuer / key / consume ledger を 再発行する。bundle
に入るのは audience / consume path などの non-secret intent だけです。

`data/` の内容は export request の `scope.data` で制御される (`postgres` / `blobs` / `memory` / `profiles`)。

Accounts 内部の typed payload kind は `takosumi.accounts.installation-export-bundle@v1`。現時点で実装済みなのは、
installation/source/bindings/grants/OIDC metadata からこの payload を組み立てる codec と、別 Takosumi Accounts issuer へ
import する create request planner です。Accounts export operation の signed download redirect endpoint、JSON import
API、JSON/tar.zst import CLI、metadata-only tar.zst archive writer、 configured export worker adapter、dev/local
metadata export worker CLI config に加え、completed export response の `downloadUrl` を `takosumi-git export --output`
で保存する経路も実装済みです。archive writer は configured provider から compiled manifest と deterministic data files
を受け取り、age wrapped archive と injectable object-store uploader による signed download URL も扱えます。

Phase 1.6 時点の残りは、product/provider ごとの production live dump / restore adapter と Keycloak など upstream IdP
を実際に接続した外部環境 smoke です。AppInstallation 台帳上の `shared-cell` → `dedicated` materialize → export
operation → 別 Accounts instance への `self-hosted` import は
`takosumi-cloud/packages/accounts-service/src/mod_test.ts` の lifecycle e2e で covered です。

### 3.3 Encryption

bundle は default で **age 暗号化**される (`POST /export` の
`encryption.method: "age"`、`recipients: ["age1..."]`)。`none` も指定可能だが 非推奨。

## 4. Self-host import

export bundle (または直接 Git clone) を、自前の takosumi インスタンスに install する。

### 4.1 CLI

```bash
takosumi-git import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

`--to` は **self-host 側の Takosumi Accounts (= account plane)** の base URL。 OIDC issuer は import 先の Takosumi
Accounts が `operator.identity.oidc` として 発行する。Keycloak / Authentik / Auth0 などはその Accounts instance の
upstream IdP として接続し、AppInstallation の issuer を直接外部 IdP に差し替えない。 import planner は bundle 内の
source issuer を target issuer に置換し、revoked grant を import request から除外する。secret material
は移さず、self-host 側で 再発行する。Accounts API では `POST /v1/installations/import` が JSON bundle payload
を受け取り、target Accounts instance の AppInstallation として登録する。 current CLI bridge として
`takosumi-git import ./takos-export.tar.zst` は archive 内の `takos-export/bundle.json` を同 endpoint に送る。tar.zst
writer、age wrapped tar.zst import、`--restore-data` による configured data restorer への data entries 受け渡しは実装済み。
ただし production provider ごとの full live dump / restore は provider adapter の責務として追加実装する。

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

self-host 側では、AppInstallation の `identity.oidc@v1` binding は `operator.identity.oidc` を self-host Takosumi
Accounts に resolve して `issuerUrl` を得ます。既存 IdP は Takosumi Accounts の upstream として接続し、 Takos runtime が
AppInstallation ledger を迂回して直接外部 issuer を consume する形にはしません。

| issuer の例                                       | 用途                                         |
| ------------------------------------------------- | -------------------------------------------- |
| `operator.identity.oidc` から resolve した issuer | managed / self-host Takosumi Accounts        |
| Keycloak / Authentik / Auth0 / Clerk              | Takosumi Accounts の upstream IdP として接続 |

issuer 切替時の制約:

- issuer は OIDC Discovery (`/.well-known/openid-configuration`) を返す必要が ある
- `pairwise` subject mode を要求する場合は issuer 側で `subject_types_supported` が `pairwise` を含む必要がある
  (含まなければ `public` に fallback、ただし app 間 user tracking 防御は弱まる)
- export 時の `pairwiseSubject` は **新 issuer では再計算される**ため、 installation 内の Takos profile レコードは新
  subject に再 mapping される。 詳細は self-host 側
  [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  docs を参照

### 4.3 Import 後の確認

import 完了後、以下が動作することを確認する:

1. Takos の `/auth/oidc/login` から新 issuer での login が完了する
2. `/auth/oidc/callback` で profile が新 `externalSubject` に再 mapping されている
3. `data/` の Postgres / blobs / memory が import されている
4. `domain.http@v1` の hostname が新 self-host 環境で reachable

## 5. lifecycle 全体図

図中の `upgrading` / `rolling-back` / `materializing` / `exporting` / `uninstalling` は public `installation.status`
ではなく、operation metadata と InstallationEvent payload 上の transitional phase hint です。外部公開 status は
canonical 5 値 (`installing` / `ready` / `failed` / `suspended` / `exported`) に固定されます。

```txt
install ──► ready ──┬─► upgrading ──► ready (新 ref)
                    │       │
                    │       └► upgrade-failed → ready (旧 ref)
                    │
                    ├─► rolling-back ──► ready (旧 ref)
                    │
                    ├─► materializing ──► ready (mode=dedicated)
                    │       │
                    │       └► materialize-failed → ready (旧 mode)
                    │
                    ├─► exporting ──► exported
                    │
                    └─► uninstalling ──► deleted
```

各遷移は
[`InstallationEvent`](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md) として
append-only に記録される。

## 次に読むページ

- [Install API](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md) — upgrade /
  rollback / export を駆動 する REST endpoint
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md) —
  `materialize` で遷移する shared-cell / dedicated / self-hosted の比較
- [AppInstallation 台帳](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md) —
  過去世代を保存する record と event ledger
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md) — 各
  binding の export 時の 扱い (template / secret 除外)
- [Install paths](/apps/install-paths) — 3 path のうち self-host への遷移
