# Installer Pipeline

`takosumi-git` は workflow runner の延長として **InstallableApp installer**
に昇格した。Git URL を受け取り、`.takosumi/app.yml` を解釈し、workflow を
sandbox で走らせて artifact を build し、bindings を注入して
`.takosumi/manifest.yml` を kernel-bound な compute manifest に compile し、
最終的に takosumi kernel の `POST /v1/deployments` に投下する。本ページは
その install pipeline の正本として、13 step / CLI / API / sandbox / pin /
publisher verification / grant revoke を集約する。

::: info このページで依存してよい範囲 / してはいけない範囲

- 依存してよい: 13 step の順序、CLI / API の入口名、commit pin と
  manifest digest が AppInstallation 行に保存されること、build
  workflow に runtime secret は渡らないこと、AppGrant が事後 revoke
  可能であること。
- 依存してはいけない: workflow の job scheduler 内部、artifact storage
  の物理 path、preview を計算する内部 cache の TTL。これらは
  takosumi-git product の implementation note で、本ページの正本範囲外。
- 依存してはいけない: takosumi kernel が直接 Git URL を読む / `app.yml`
  を解釈する想定。**kernel は compile 後の manifest しか受けない** のが
  Installable App Model の不変条件。

:::

::: info Cross-instance service binding
本 pipeline の 13 step 中で takosumi-cloud / Takosumi Accounts 等の上位
service に access する箇所 (例: step 7 user approve は takosumi-cloud UI を
呼ぶ) は、**service identifier** (`takosumi.platform.deploy@v1` /
`takosumi.dashboard.web@v1` 等) + anchor 経由 resolve に寄せます。kernel
側の consumer resolution foundation は実装済みですが、installer pipeline の
実 placeholder materialization / account-plane provisioning は継続 work です。
endpoint URL は anchor が返す operator-injected 値です。 詳細は
[cross-instance service binding](./cross-instance-service-binding.md)。
:::

## 1. takosumi-git install pipeline (13 step)

new.md §12 の install pipeline を canonical step list として固定する。
途中で error が出れば該当 step で `failed` 状態に遷移し、AppInstallation
には `installing → failed` が記録される (詳細は
[AppInstallation 台帳](/architecture/app-installation))。

| # | step | owner | 入力 | 出力 |
| --- | --- | --- | --- | --- |
| 1 | Git URL 受信 | takosumi-git API | `source.url` / `ref` | request id |
| 2 | repository fetch | takosumi-git fetcher | shallow clone | working tree |
| 3 | ref → commit SHA pin | takosumi-git fetcher | tag/branch | `sourceCommit` |
| 4 | `.takosumi/app.yml` parse | installer | working tree | InstallableApp v1 |
| 5 | `.takosumi/manifest.yml` parse | installer | working tree | template manifest |
| 6 | install preview 生成 | preview service | step 4 / 5 + binding catalog | preview JSON |
| 7 | user approve | takosumi-cloud UI / API | preview | approval token |
| 8 | workflow sandbox 実行 | workflow runner | `.takosumi/workflows/*.yml` | artifact URI / image digest |
| 9 | artifact resolve | installer | workflow output | `${artifacts.*}` 解決 map |
| 10 | bindings 注入 | binding broker | AppBinding 行 (Step 7 で確定) | `${bindings.*}` 解決 map |
| 11 | manifest compile | manifest compiler | template + maps | compiled manifest + digest |
| 12 | kernel deploy | kernel client | compiled manifest | `Deployment.id` |
| 13 | AppInstallation `ready` | installer | step 11 / 12 | `status: ready`, `runtimeBindingId` |

`.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml`
(kernel-bound) は **明確に別物** で、step 4 / 5 で別 parser を通す。
混同するとビルド出力が kernel に渡らない (kernel は `app.yml` を受けない)。
詳細は [.takosumi/app.yml spec](/reference/app-yml-spec) と
[.takosumi/manifest.yml](/reference/manifest-spec) を参照。

## 2. CLI: `takosumi install`

```bash
takosumi install https://github.com/takos/takos --ref v1.2.3
```

主な flag:

| flag | 意味 |
| --- | --- |
| `--ref <tag\|commit>` | install 対象の ref。tag か commit に pin する (§4 参照) |
| `--space <id>` | 投下先 Space。省略時は personal space |
| `--mode shared-cell\|dedicated` | RuntimeBinding の初期 mode (default `shared-cell`) |
| `--binding <key>=<value>` | binding 上書き (例: `--binding auth=keycloak-prod`) |
| `--auto-approve` | preview 確認なしで実行 (CI 用、対話 install では禁止) |

CLI は最終的に `POST /v1/installations` を呼ぶ thin wrapper であり、
preview / approve も対話 mode では `POST /v1/install/preview` を経由する。

## 3. API: `POST /v1/installations`

### Request

```http
POST /v1/installations
Content-Type: application/json
Authorization: Bearer <takosumi-account-token>

{
  "source": {
    "type": "git",
    "url": "https://github.com/takos/takos",
    "ref": "v1.2.3"
  },
  "target": {
    "spaceId": "space_personal",
    "mode": "shared-cell"
  },
  "params": {
    "domain": "auto"
  },
  "bindings": {
    "auth": "takosumi-accounts-default",
    "database": "managed-postgres-small",
    "blob": "managed-object-store",
    "deploy": "default-gitops"
  }
}
```

### Response

```json
{
  "installationId": "inst_abc",
  "appId": "takos.chat",
  "sourceCommit": "7f3c9...",
  "appManifestDigest": "sha256:...",
  "compiledManifestDigest": "sha256:...",
  "mode": "shared-cell",
  "url": "https://takos-acct123.takosumi.app",
  "status": "ready"
}
```

完全な wire shape (preview / launch-token / materialize / export / upgrade
/ rollback) は [Install API リファレンス](/reference/install-api) に集約する。

## 4. Commit pin の必須性

InstallableApp は **必ず commit SHA に pin** された状態で install される。
`ref=main` / `ref=latest` のような移動 ref は受け付けない。これにより:

- AppInstallation 行は `sourceRef` (人間用 label) と `sourceCommit`
  (machine 用 immutable identity) の 2 列を保持できる。
- upgrade / rollback / export 時に「何を install したか」を後から説明できる。
- supply chain attack 検知 (`sourceCommit` が突然変わったら incident) が成立する。

```txt
良い:
  ref=v1.2.3      → resolve → commit=7f3c9...
  commit=7f3c9... (直接 pin)

悪い:
  ref=main
  ref=latest
```

CLI / API はこの規律を Step 3 (ref → commit SHA pin) で強制する。pin に
失敗した場合 (force-pushed tag 等) は install を `failed` で停止する。

## 5. Workflow sandbox

任意 Git repo の workflow を runtime secret 込みで実行すると、binding
secret や OIDC client secret が build log や artifact に漏れる。これを
防ぐため、workflow runner は **build phase / deploy phase を物理的に分離**
する (new.md §22.4)。

### 5.1 build phase の制約

- runtime secrets は **一切渡さない** (`OIDC_CLIENT_SECRET` / database
  password / object store key など)。
- network egress は allowlist 制 (default は registry / cache mirror のみ)。
- 出力は artifact (image digest / static asset URI) **だけ** が installer
  に返る。stdout / stderr は build log に残るが secret 検知 scrubber を通る。
- workflow が要求する extra secret は AppBinding 経由でなく
  `secrets:` フィールドで明示宣言され、ユーザー approve 必須。

### 5.2 deploy phase の制約

- compiled manifest への binding 注入は **installer 内部** で行い、
  workflow からは触れない。
- runtime secret (OIDC client secret / DB password) は kernel への
  `Deployment.spec.env` として渡るが、build log には出ない (secret ref
  → 値の resolution は kernel apply 直前)。
- kernel は manifest 内の `${bindings.*}` / `${secrets.*}` placeholder を
  受け付けない (compile 済みの実値しか受けない)。

## 6. Publisher verification

`.takosumi/app.yml` の `metadata.publisher` は signing key と紐付き、
verified publisher (例: `publisher: takos`) は preview 上に "verified"
表示される。未検証の repo は明示的な警告と「これは野良 install です」
banner を preview に出して、ユーザーが grant 範囲をより慎重に check
できるようにする。

```txt
This app is not from a verified publisher.
Review its manifest and permissions carefully.
```

verification は signing key + publisher domain の両方をチェックし、
preview JSON の `app.verified: boolean` として返る。

## 7. AppGrant revoke

install 完了後に AppGrant は **いつでも revoke** できる。ユーザーが
preview で approve した capability (例: `deploy.intent.write` /
`logs.read.own`) は AppGrant 1 行ずつに分解され、revoke もそれぞれ
独立に行える。

revoke 時の挙動:

- 該当 AppBinding が secret rotate 対象なら secret を新しい値に差し替え、
  古い secret は invalidate される。
- runtime に伝搬するのは next request からで、in-flight request は
  完了する (graceful)。
- revoke は InstallationEvent ledger に append-only で記録される。

詳細な capability 一覧と revoke API は
[Binding Catalog](/reference/binding-catalog) と
[Install API](/reference/install-api) を参照。

## 次に読むページ

- [.takosumi/app.yml spec](/reference/app-yml-spec)
  step 4 で parse する InstallableApp v1 の field 定義。
- [Install API リファレンス](/reference/install-api)
  `POST /v1/install/preview` と `POST /v1/installations` の完全な wire shape。
- [AppInstallation 台帳](/architecture/app-installation)
  installer pipeline の各 step が AppInstallation status をどう動かすか。
- [Binding Catalog](/reference/binding-catalog)
  step 10 で注入される binding 種別と AppGrant の対応。
- [Runtime Modes](/architecture/runtime-modes)
  step 13 で確定する `mode` 列の意味。
