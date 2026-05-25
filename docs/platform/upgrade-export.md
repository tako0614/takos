# Deployment update / ロールバック / エクスポート

> このページでわかること: インストール済みアプリの更新、巻き戻し、dedicated
> materialize、export / import の扱い。

## 1. Deployment update

Installation に新しい source を apply する操作。Accounts は deploy request を
broker / authorize し、kernel の `POST /v1/installations/{id}/deployments` が
Deployment を作ります。`Deployment.status: "succeeded"` になったあと、Accounts
は `currentDeploymentId`、source identity、digest、event metadata を ledger に
projection します。

### 1.1 CLI

```bash
takosumi deploy inst_abc --source https://github.com/example/my-app --ref v1.2.4
```

`--ref` には tag / branch / commit SHA を指定できます。dry-run は git ref を
resolved commit に固定し、apply は `expected.commit` と
`expected.manifestDigest`、さらに deploy dry-run 時点の
`expected.currentDeploymentId` で review 済み source と base Deployment pointer
を guard します。prepared source では `expected.sourceDigest` を使います。
operator policy は production install で mutable branch を拒否してもよい。

### 1.2 流れ

```txt
1. new ref fetch       (takosumi が source repo から指定 ref を pin)
2. AppSpec parse       (.takosumi.yml を parse し metadata / components 抽出)
3. deployment dry-run  (current source / digest と next source / digest の diff)
4. binding diff        (binding material / policy impact の add/remove)
5. material review     (database / object-store / domain 等の material-level review)
6. approve             (UI / CLI で operator approval evidence と costAck を ack)
7. apply               (kernel が Deployment を作り、Accounts が succeeded Deployment を projection)
```

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
  - binding/policy change: none
  - material review: database.postgres changed

Estimated cost change:
  no change

[Cancel]                                              [Upgrade]
```

binding / material / policy change が privilege や cost を増やす場合は、UI が
install dry-run と同等の operator approval を再度通すことを要求する。

### 1.4 channel policy

upgrade channel policy は Takos product catalog / account-plane install-source
policy で扱います。AppSpec root は `apiVersion` / `metadata` / `components`
だけです。

```yaml
# catalog/account-plane policy object; not `.takosumi.yml`
upgradePolicy:
  securityPatch: automatic
  minor: ask
  major: ask
```

- `automatic`: ユーザ ack なしで operator install service が自動 upgrade
- `ask`: 必ず UI / CLI で ack
- `pin`: 自動 upgrade を一切行わない

`securityPatch` channel での自動 upgrade は **binding / material / policy change
が approval を要求せず、かつ costAck 不要** な場合のみ実行される。

## 2. Rollback

retained `succeeded` Deployment を current pointer として選び直す操作。rollback
は新しい Deployment を作らず、過去 Deployment の source pin / manifest digest /
activation evidence を authority とする。

### 2.1 CLI

```bash
takosumi rollback inst_abc dep_previous
```

指定された Deployment が当該 Installation の Deployment 履歴に存在しない場合は
`not_found`、`succeeded` でない場合は `failed_precondition` の error envelope
を返す。

### 2.2 必要保存物

current Accounts 台帳は、upgrade / rollback の revision event に次を記録する:

- source ref / resolved source identity
- AppSpec byte digest (`manifestDigest`)
- retained evidence refs / public non-secret outputs
- requested binding material / policy decision snapshot
- operator approval evidence / `costAck` の confirm evidence

データそのもの (Postgres rows / blob objects) は **rollback で巻き戻されない**。
current rollback は ledger source pointer の revision として扱う。large blob /
data dump retention や database restore marker の世代保持は operator policy /
provider evidence の領域であり、このページでは current guarantee
としては扱わない。

### 2.3 制限事項

- provider data copy / schema migration の巻き戻しは rollback の current
  guarantee ではない
- `service-binding` / `object-store` / `http-endpoint` material と
  activated HTTP domain projection の変更は binding-level review と user approval
  の対象
- production-grade large blob retention / rollback drill は managed offering
  launch-readiness evidence 側で扱う

dry-run は binding material / policy impact / cost の差分を示し、必要な operator
approval を要求する。

## 3. Export bundle

Installation を取り出してセルフホストするための bundle を生成します。

現時点で verified な path は bundle / API / archive / restorer bridge
までです。data dump は provider が export data provider / restorer
を構成した場合に含まれます。production full live dump / restore は managed
offering launch-readiness evidence で確認します。

Export は「source pin と bundle metadata を持ち出し、target で新しい identity
を生成する」操作です:

- ✅保持される: source identity pin / `manifestDigest` / retained evidence refs
  / public non-secret outputs / binding template / provider 構成済みの場合のみ
  data dump (DB / blobs / memory / profiles)
- ⚠ target で再生成される: OIDC client (新 `client_id` / `client_secret`)、
  pairwise subject (新 issuer で再計算)、InstallationEvent ledger (新
  chain)、launch token の発行 context
- ❌移植されない: instance を跨ぐ audit chain、source instance での access
  history と target の continuity を link する protocol 手段

user の identity は source / target instance で別 entity として扱われ、 link
は持ちません。これは
[per-instance scope の trade-off](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/design-principles.md#7-per-instance-scope-sovereignty-trade-off)
の直接の帰結です。federation が必要なユースケースは app-layer (例: yurucommu の
ActivityPub) で対応します。

### 3.1 CLI

```bash
takosumi-cloud accounts installations export inst_abc --output takos-export.tar.zst
```

Takosumi Accounts lifecycle API 経由なら
[`POST /v1/installations/{id}/export`](https://github.com/tako0614/takosumi-cloud/blob/main/docs/accounts-service.md#_5-post-v1-installations-id-export)。

### 3.2 Bundle 構造 {#export-bundle}

bundle (tar.zst) を展開すると、次の directory tree になる:

```txt
takos-export/
  bundle.json
  installation.json
  source.json
  source/
    .takosumi.yml
  deployment/
    outputs.json
  data/
    index.json
    postgres.dump
    blobs/
    memory.jsonl
    profiles.jsonl
  binding-template/
    template.yml
    identity.oidc.yml
    db.connection.yml
    media.bucket.yml
    activated-http-domain.yml
    installer.facade.yml
    launch-token-context.yml
  docs/
    restore.md
```

`bundle.json` は Accounts API が直接受け取る machine-readable payload
(`takosumi.accounts.installation-export-bundle@v1`)。
`takosumi-cloud accounts installations import ./takos-export.tar.zst` はこの
file を読んで `POST /v1/installations/import` に送る。`installation.json` /
`source.json` / `source/.takosumi.yml` / `binding-template/*.yml` は restore
review と手動復旧用の public projection。

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
    "manifestDigest": "sha256:...",
    "retainedEvidenceRef": "..."
  }
}
```

`binding-template/*.yml` には各 binding / projection profile の **provisioning
templates** が入る (secret material は **含まない**; self-host 側の Takosumi
Accounts が再 materialize する)。 launch-token context template は audience /
consume path / canonical origin intent などの non-secret redeem context
だけを持ちます。launch token は catalog material contract ではなく Cloud-owned
account-plane bootstrap flow であり、target Accounts instance が token と consume
ledger を再生成します。

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
takosumi-cloud accounts installations import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

`--to` は **self-host 側の Takosumi Accounts (= account plane)** の base URL。
OIDC issuer は import 先の Takosumi Accounts が `operator.identity.oidc` として
発行する。Keycloak / Authentik / Auth0 などはその Accounts instance の upstream
IdP として接続し、Installation の issuer を直接外部 IdP に差し替えない。 import
planner は bundle 内の source issuer を target issuer に置換し、revoked grant を
import request から除外する。secret material は移さず、self-host 側で
再発行する。Accounts API では `POST /v1/installations/import` が JSON bundle
payload を受け取り、target Accounts instance の staged Installation
として登録する。target Accounts は binding / secret / OIDC material
を再生成し、target kernel Installer API に apply して新しい target Deployment id
を受け取ったあと、`currentDeploymentId` を projection して `ready`
にする。metadata-only restore は non-ready staged import として扱う。 current
CLI bridge として
`takosumi-cloud accounts installations import ./takos-export.tar.zst` は archive
内の `takos-export/bundle.json` を同 endpoint に送る。tar.zst writer、age
wrapped tar.zst import、`--restore-data` による configured data restorer への
data entries 受け渡しは実装済み。ただし production provider ごとの full live
dump / restore は provider adapter の責務として追加実装する。

```bash
takosumi-cloud accounts installations import ./takos-export.bundle.json \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

bundle ではなく Git URL から直接 install する経路も同等にサポートされる:

```bash
takosumi install https://github.com/example/my-app --ref v1.2.3 \
  --to https://my-takosumi.example.com
```

### 4.2 OIDC issuer の再解決

self-host 側では、Installation の `identity.oidc@v1` binding は
`operator.identity.oidc` を self-host Takosumi Accounts に resolve して
`issuerUrl` を得ます。既存 IdP は Takosumi Accounts の upstream として接続し、
Takos runtime が Installation ledger を迂回して直接外部 issuer を consume
する形にはしません。

| issuer の例                                       | 用途                                         |
| ------------------------------------------------- | -------------------------------------------- |
| `operator.identity.oidc` から resolve した issuer | managed / self-host Takosumi Accounts        |
| Keycloak / Authentik / Auth0 / Clerk              | Takosumi Accounts の upstream IdP として接続 |

issuer 切替時の制約:

- issuer は OIDC Discovery (`/.well-known/openid-configuration`) を返す必要が
  ある
- Takos runtime が受け取る `sub` は per-Installation / per-client の pairwise
  subject である必要がある。外部 IdP が upstream にある場合も、Takosumi Accounts
  が broker として runtime 向け subject を再発行する
- export 時の `pairwiseSubject` は **新 issuer では再計算される**ため、
  installation 内の Takos profile レコードは新 subject に再 mapping される。
  詳細は self-host 側
  [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/main/docs/architecture/takosumi-accounts.md)
  docs を参照

### 4.3 Import 後の確認

import 完了後、以下が動作することを確認する:

1. Takos の `/auth/oidc/login` から新 issuer での login が完了する
2. `/auth/oidc/callback` で profile が新 `externalSubject` に再 mapping
   されている
3. `data/` の Postgres / blobs / memory が import されている
4. activated HTTP domain projection の hostname が新 self-host 環境で reachable

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
                    └─► uninstalling ──► suspended ledger (retained)
```

各遷移は
[`InstallationEvent`](https://github.com/tako0614/takosumi-cloud/blob/main/docs/architecture/app-installation.md)
として append-only に記録される。

## 次に読むページ

- [Takosumi Accounts lifecycle API](https://github.com/tako0614/takosumi-cloud/blob/main/docs/accounts-service.md)
  — upgrade / rollback / export を駆動する operator account-plane REST endpoint
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
  — `materialize` で遷移する shared-cell / dedicated / self-hosted の比較
- [Installation 台帳](https://github.com/tako0614/takosumi-cloud/blob/main/docs/architecture/app-installation.md)
  —過去世代を保存する record と event ledger
- [AppSpec publish/listen bindings](https://takosumi.com/docs/reference/manifest)
  —各 binding の export 時の扱い (template / secret 除外)
- [Install paths](/apps/install-paths) — 3 path のうち self-host への遷移
