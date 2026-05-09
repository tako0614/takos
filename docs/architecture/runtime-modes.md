# Runtime Modes

AppInstallation が物理的に動く形は、`shared-cell` / `dedicated` / `self-hosted`
の 3 mode に正規化される。**所有権・data namespace・OIDC binding は mode
に依らず同じ AppInstallation 行に紐づき**、変わるのは「runtime process
を誰がどこで持つか」だけ。本ページは、その 3 mode の比較と、shared-cell から
dedicated / self-hosted へ遷移するときの規律を定める。

::: info このページで依存してよい範囲 / してはいけない範囲

- 依存してよい: `mode` 列 (`shared-cell` / `dedicated` / `self-hosted`)、
  RuntimeBinding が runtime host
  を抽象化していること、`takosumi-git materialize` / `takosumi-git export` が
  mode 切替の正面 entry point であること、URL (`takos.jp/chat` 等) は mode
  に依らず保たれること。
- 依存してはいけない: 各 mode の物理 implementation 詳細 (cell の k8s namespace
  命名、shared runtime の image tag、materialize の中間 cutover
  algorithm)。これらは [installer pipeline](/architecture/installer-pipeline) と
  AppInstallation state machine 側の事項であり、本ページの示す範囲を超えて
  読み込むと壊れる。

:::

::: info Cross-instance service binding OIDC issuer / Takosumi Accounts
への接続は **service identifier** (`takosumi.account.auth@v1`) +
`serviceResolvers[]` (anchor) 経由で resolve されます。endpoint URL は anchor
が返す operator-injected 値で、mode 切替によって変わりません。 詳細は
[cross-instance service binding](./cross-instance-service-binding.md)。 :::

## 1. 3 mode の責務比較

| 項目            | `shared-cell`                                                       | `dedicated`                                                         | `self-hosted`                                                                                         |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| runtime process | Takos 公式 prebuilt cell に同居                                     | AppInstallation 専用に切り出した dedicated deployment               | 利用者の takosumi に install された deployment                                                        |
| build 待ち      | なし (warm 済み image を bind)                                      | あり (initial materialize 時に build)                               | あり (export bundle / Git clone から install)                                                         |
| OIDC issuer     | service identifier `takosumi.account.auth@v1` (anchor 経由 resolve) | service identifier `takosumi.account.auth@v1` (anchor 経由 resolve) | self-host Takosumi Accounts を `takosumi.account.auth@v1` として anchor resolve。外部 IdP は upstream |
| billing         | Takosumi Cloud                                                      | Takosumi Cloud                                                      | self-host Takosumi Accounts / operator billing                                                        |
| data namespace  | installation 専用                                                   | installation 専用 (shared-cell からそのまま継承)                    | export bundle として持ち出し、import 先で再生成                                                       |
| operator        | Takosumi Cloud                                                      | Takosumi Cloud                                                      | 利用者                                                                                                |
| 主な用途        | instant start / 一般ユーザー                                        | 専用容量・隔離・性能要件                                            | 退出 / 主権 / enterprise                                                                              |

## 2. 共有されるもの vs ユーザーごとに分かれるもの

`shared-cell` は「runtime process は共有、所有・identity・billing は分離」
という非対称な構造を取る。これを混同すると "共有 = 全部共有" の誤解を生むので、
new.md §10.1 の分割表を canonical として採用する。

### 2.1 ユーザーごとに分かれるもの (per AppInstallation)

- Takosumi Account / Space / AppInstallation 行そのもの
- AppBinding (OIDC client、database、object store、deploy intent)
- AppGrant (capability 権限)
- data namespace (Postgres schema / object store prefix / memory partition)
- billing line item と usage metering
- launch token JWS の audience / nonce
- export boundary

### 2.2 mode 内で共有されるもの (shared-cell のみ)

- runtime process / container instance
- prebuilt image と warm 済み JIT state
- common frontend cell (静的 asset / edge router)

`dedicated` と `self-hosted` ではこの 3 項目も per-installation になる。
`shared-cell` だけが「physical runtime を 1 hop 共有して instant start を稼ぐ」
最適化と捉えること。

## 3. shared-cell から dedicated への materialize 流れ

`takosumi-git materialize` は、既存 AppInstallation
を破壊せず物理形だけ差し替える 操作として定義されている。AppInstallation 行
(`id` / `appId` / `sourceCommit` / `appManifestDigest` /
`compiledManifestDigest` / `runtimeBindingId`) は同じ ID を keep し、`mode` 列と
`runtimeBindingId` 参照先だけが変わる。

```bash
takosumi-git materialize inst_abc --mode dedicated
```

API では同等に:

```http
POST /v1/installations/inst_abc/materialize
Content-Type: application/json

{
  "mode": "dedicated",
  "region": "tokyo"
}
```

外部公開される AppInstallation `status` は canonical 5 値のまま固定される
(詳細は [AppInstallation 台帳](/architecture/app-installation)
§state)。materialize の進行は `installation.materialize_requested` /
`installation.materialize_succeeded` / `installation.materialize_failed` などの
InstallationEvent と operation metadata に記録し、`materializing` は独立した
public status ではない。進行中も既存 shared-cell 上の Takos は受付を続け、
cutover 完了後に RuntimeBinding を atomic に差し替える。失敗時は shared-cell
に戻す (重大失敗時のみ canonical `failed` に落ちる)。

materialize で **保たれるもの**:

- source commit (`sourceCommit`)
- app manifest digest (`appManifestDigest`)
- compiled manifest digest (`compiledManifestDigest`)
- data namespace (Postgres dump / object blobs / memory)
- OIDC client binding (issuer / client_id / pairwise sub / redirect URI)
- domain (canonical URL)
- AppGrant 一覧

materialize で **変わるもの**:

- `mode` 列 (`shared-cell` → `dedicated`)
- `runtimeBindingId` (新しい RuntimeBinding を append)
- 物理 runtime の host (Takosumi の dedicated worker plane に切り出す)
- 課金 line item (`compute_usage` の rate が dedicated tier に変わる)

## 4. self-hosted への export

`self-hosted` は「Takosumi Cloud から完全退出して、利用者自身の takosumi
インスタンスで動かす」mode。`takosumi-git export` で installation bundle を
取り出し、`takosumi-git install` で別の takosumi にインポートする。

```bash
takosumi-git export inst_abc --output takos-export.tar.zst
takosumi-git import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

bundle は import API payload の `bundle.json`、`installation.json` (source /
digests)、`manifest.compiled.yml`、`data/` (postgres dump / blobs / memory /
profiles)、`bindings/template.yml`、`docs/restore.md` を含む。import 先では
`serviceResolvers[]` を自前 anchor に向け、`takosumi.account.auth@v1` を
self-host Takosumi Accounts に resolve させる:

```bash
takosumi-git import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

export 後の元 installation は、利用者の選択により canonical `exported` (data
残存 / runtime 維持) か、uninstall operation による退役を選べる。 `uninstalling`
は operation metadata / event payload 上の phase hint であり、 public status
enum ではない。

## 5. URL の連続性

mode を切り替えても、ユーザーが見る URL は変えない。これは Installable App Model
の core invariant の一つで、`shared-cell` / `dedicated` の materialize は
**routing layer の差し替えだけ**で表現される。

| 形                   | URL                                  |
| -------------------- | ------------------------------------ |
| canonical app URL    | `https://takos.jp/chat`              |
| installation default | `https://takos-acct123.takosumi.app` |

`shared-cell` 時はこの URL が shared runtime cell の上の per-installation router
に着き、`dedicated` 時は同 URL が専用 deployment に着く。利用者から
見れば「チャット URL は変わらず動き続けた」だけ。`self-hosted` では URL ホストが
import 先 (`https://chat.example.com` 等) に変わるが、そこは 利用者自身が DNS と
OIDC redirect を再設定する自然な遷移として扱う。

## 次に読むページ

- [Installable App Model 全体像](/architecture/installable-app-model) 3 mode が
  AppInstallation の `mode` 列としてどう座っているか。
- [AppInstallation 台帳](/architecture/app-installation) canonical 5 status と、
  `materializing` / `exporting` などの transitional phase hint。
- [Installer Pipeline](/architecture/installer-pipeline) `shared-cell` で "build
  待ちなし" を実現する prebuilt cell の起源。
- [Upgrade / Export](/platform/upgrade-export) 運用者向けの upgrade / rollback /
  export 手順。
- [Install API](/reference/install-api) `POST /v1/installations/:id/materialize`
  / `/export` の wire shape。
