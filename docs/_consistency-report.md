# Consistency Report (Wave 4)

Generated: 2026-05-07 13:35:00
Reviewed: 39 files (Wave 1: 12 new, Wave 2: 9 major-rewrite, Wave 3: 18 partial)

## Summary

- Block: 2 → **0** (resolved)
- Warn: 6 → **0** (resolved)
- Info: 3 → **0** (resolved)

> **2026-05-09 Update**: 本 Wave 4 audit で記録された全 finding (Block 2 /
> Warn 6 / Info 3) は Wave 5〜13 round と 2026-05-09 cross-instance service
> binding audit で resolved 済。 各 finding section の `Repair` 欄に書かれた
> 対応は完了し、 `validate:agent-docs` / `validate:architecture` /
> `docs:build` 全 green。 本 report は historical snapshot として保存され、
> 現状は all clean。 詳細は ROADMAP §1.9 / 2026-05-09 audit
> 履歴を参照。

## Findings

### B-01: AppInstallation status enum が 3 ページで 3 種類

**Label**: Block
**Files**:
- `/home/tako/Desktop/takos/takos/docs/architecture/app-installation.md`
- `/home/tako/Desktop/takos/takos/docs/reference/install-api.md`
- `/home/tako/Desktop/takos/takos/docs/platform/upgrade-export.md`

**Issue**:
canonical な status enum (new.md §7) は 5 値:
`installing` / `ready` / `failed` / `suspended` / `exported`。

しかし pages 間で次のように差分がある:

- `architecture/app-installation.md:99-103`: 5 値のみ (canonical)。state 遷移
  図 (`L240-264`) も 5 値 + `(purged)` 注記のみ。
- `reference/install-api.md:96, 349, 415, 477`: `materializing` /
  `uninstalling` / `state-conflict` で **`materializing`** を `409` の発行
  不能 status に列挙 (`L477`)。
- `platform/upgrade-export.md:280-292`: 状態遷移図に
  `upgrading`, `rolling-back`, `materializing`, `exporting`, `uninstalling`,
  `upgrade-failed`, `materialize-failed`, `deleted` の 8 中間状態を導入。
  `architecture/app-installation.md` の "5 値 only" 宣言と直接矛盾。

正本 (new.md §7) は中間状態を持たない。実装上必要なら、
`architecture/app-installation.md` 側に `transitional substates` 節を追加
してそれら 8 値を **明示的に列挙** し、3 ページで同じ列挙にする必要がある。

**Repair**:
- `architecture/app-installation.md:96-104` の `status:` union literal を 5
  値のままにし、その下に "Transitional substates (in-flight phases)" 節を
  追加。`installing` の subset として `upgrading` / `rolling-back` /
  `materializing` / `exporting` / `uninstalling`、`failed` の subset として
  `upgrade-failed` / `materialize-failed`、退役後の `deleted` を、
  upgrade-export.md と install-api.md の表現と一致させる形で正本化。
- 担当 Wave: W3.B1 (architecture) と W3 / W2 のうち install-api.md 担当
  batch (Batch 1.4) の coordinator が共同で adjust。Wave 5 round 1 で
  app-installation.md を編集し、3 ページで status enum 一致を達成する。

---

### B-02: `architecture/control-plane.md:261` の routing 表で kernel host に "auth" 列挙

**Label**: Block
**Files**:
- `/home/tako/Desktop/takos/takos/docs/architecture/control-plane.md`

**Issue**:
`L261`:
```
- kernel host (`{KERNEL_DOMAIN}`) → kernel API / auth / settings
```

同 page の `L40` / `L248-251` で kernel features に "Auth は **含めず**、
[Takosumi Accounts](./takosumi-accounts.md) の OIDC issuer 経由で consume
する" と明言しているのに、routing layer 節は **kernel host が auth を
serve する** と書いている。これは次の正本記述と直接矛盾:

- `architecture/kernel.md:45-49`: Auth は kernel features に含めない
- `architecture/installable-app-model.md:294-296`: Auth/identity は
  Takosumi Accounts の責務
- `architecture/system-architecture.md:202`: kernel features に Auth と
  Billing は含めない
- new.md §2.1 / §17

**Repair**:
- `architecture/control-plane.md:261` の
  `kernel host (\`{KERNEL_DOMAIN}\`) → kernel API / auth / settings`
  を `kernel host (\`{KERNEL_DOMAIN}\`) → kernel API / settings` に
  変更し、`auth` を削除。auth route は Takosumi Accounts (account plane)
  が serve する旨の補足を 1 行追加 (例:
  "auth (`/oauth/*`) は Takosumi Accounts (`accounts.takosumi.cloud`) が
  serve するため kernel host の routing 対象外")。
- 担当 Wave: W3.B2 (Batch 2.2 大改訂組) の control-plane.md 担当。

---

### W-01: `architecture/installable-app-model.md:295` で "Auth と Billing" のうち Billing が抜けている

**Label**: Warn
**Files**:
- `/home/tako/Desktop/takos/takos/docs/architecture/installable-app-model.md`

**Issue**:
`L294-296`:
```
既存 [Kernel](./kernel.md) は kernel features を説明します。Installable App
Model では kernel features に **Auth を含めません**。Auth/identity は
Takosumi Accounts の責務です。
```

他の 4 page (`architecture/index.md:30`, `kernel.md:45`,
`system-architecture.md:202, 333`, `control-plane.md:40`) はすべて "Auth と
Billing は含めない" と 2 項目セットで書いているが、本ページだけ
"Auth" のみで Billing が抜けている。新モデルの不変条件としては Billing も
含まれない (kernel.md L51-60、new.md §2.1 で billing 不在を明言)。

**Repair**:
- `architecture/installable-app-model.md:295` を
  `kernel features に **Auth と Billing を含めません**。Auth/identity は`
  に変更し、続く文に "Billing も Takosumi Cloud billing が責務" の補足を
  追加。
- 担当 Wave: W3.B1 (architecture/installable-app-model.md は Wave 1 Batch
  1.1 で新設、Wave 5 で touch up)。

---

### W-02: `architecture/takosumi-accounts.md:106` に `/oauth/userinfo` が新設されている (new.md §8.1 の列挙にない)

**Label**: Warn
**Files**:
- `/home/tako/Desktop/takos/takos/docs/architecture/takosumi-accounts.md`

**Issue**:
new.md §8.1 が列挙する Takosumi Accounts OIDC endpoint は 7 個:
`/.well-known/openid-configuration`, `/oauth/authorize`, `/oauth/token`,
`/oauth/device/code`, `/oauth/jwks`, `/oauth/revoke`, `/oauth/introspect`。

`takosumi-accounts.md:97-106` ではこれに加えて
`/oauth/userinfo` (UserInfo endpoint) が **正本表に列挙** されている。
OIDC 仕様としては必須 endpoint だが、本プランの canonical input である
new.md §8.1 には記述がないため、"new.md からの逸脱" として記録。

**Repair**: 2 択:
1. `takosumi-accounts.md:106` の `/oauth/userinfo` 行を削除して new.md と
   揃える。
2. `/oauth/userinfo` を残し、その横に "(OIDC standard requirement, new.md
   §8.1 の core list を実装上補完)" の注記を入れる。

推奨は 2 (実装上必要なため)。担当 Wave: W3.B1 (architecture)。

---

### W-03: `get-started/index.md:85, 90` にユーザー導線として Google OAuth と "OAuth settings" tab が残っている

**Label**: Warn
**Files**:
- `/home/tako/Desktop/takos/takos/docs/get-started/index.md`

**Issue**:
ページ前半 (`L17-65`) は new model の "Use Takos / Install from Git /
Self-host" の 3 path で書き直されているが、後半 `L74-92` "3 分で始める" 節
が **legacy operator login の流れのまま**残っている:

- `L85`: `未ログインなら /auth/login から Google OAuth へ進みます`
  → 一般ユーザーは Takosumi Accounts OIDC へ進むはず (operator login と
  user login が混在)。
- `L90`: `Takos Web の account settings から OAuth settings を開き、
  Personal Access Tokens tab で PAT を発行`
  → "OAuth settings" tab は legacy 用語。Installable App Model では
  Takos 側に OAuth settings UI は無く、PAT 発行も Takosumi Account 配下
  の設定 UI に移る前提。

このセクションの読者を operator (= bootstrap 担当) に絞るか、user 向け
であれば Takosumi Accounts 経由の login に書き換える必要がある。

**Repair**:
- `get-started/index.md:74` の `### 1. Takos Web に入る` 節の冒頭で
  対象読者を operator に明示し、user 向けには別節 "## 一般ユーザー
  (Use Takos)" を追加して、`/auth/oidc/login` への動線を書く。
- もしくは `L85` の `Google OAuth` を `(operator login: Google OAuth /
  user login: Takosumi Accounts OIDC)` の括弧書きにし、`L90` の
  "OAuth settings" を `account settings の Personal Access Tokens tab` に
  リネーム。
- 担当 Wave: W3.B4 (get-started 系の Batch)。

---

### W-04: `platform/store.md:225` の "OAuth client" 表記が legacy 文脈

**Label**: Warn
**Files**:
- `/home/tako/Desktop/takos/takos/docs/platform/store.md`

**Issue**:
`L222-226`:
```
manifest と deploy を通じて、以下が自動的に関連づけられます:

- group identity / service / route / hostname
- resource binding / OAuth client
- publication registration (MCP server, file handler, etc.)
```

"OAuth client" は新モデルでは AppInstallation の `identity.oidc@v1`
AppBinding が発行する OIDC client を指すか、legacy `takos.oauth-client`
publication を指すかが曖昧。

**Repair**:
- `L225` を `resource binding / OIDC client (`identity.oidc@v1` AppBinding 経由)`
  に変更し、glossary の `OAuth Client (deprecated)` entry へリンクする。
- 担当 Wave: W3.B2 (platform 系)。

---

### W-05: `apps/launch-token.md:76` "Takosumi Accounts `/oauth/token`" は launch token とは無関係

**Label**: Warn
**Files**:
- `/home/tako/Desktop/takos/takos/docs/apps/launch-token.md`

**Issue**:
`L71-79` の比較表で **launch token vs OIDC ID token** を並べる際、
OIDC ID token の `発行 endpoint` を `Takosumi Accounts /oauth/token` と
書いている。これは正しい (token endpoint で ID token が交付される) が、
launch token の `発行 endpoint` が `Takosumi Accounts の installation API`
と書かれているだけで、具体的な path (`POST /v1/installations/{id}/launch-token`)
が示されていない。

`reference/install-api.md` には `POST /v1/installations/{id}/launch-token`
が定義されているので cross-reference を強化したい。

**Repair**:
- `apps/launch-token.md:76` を
  `Takosumi Accounts のinstallation API ([POST /v1/installations/{id}/launch-token](/reference/install-api))`
  に変更。
- 担当 Wave: W3.B3 (apps の launch-token 担当)。

---

### W-06: `architecture/installable-app-model.md` の **5 entity** vs `architecture/index.md` の **Installable App Model 5 章**

**Label**: Warn
**Files**:
- `/home/tako/Desktop/takos/takos/docs/architecture/installable-app-model.md`
- `/home/tako/Desktop/takos/takos/docs/architecture/index.md`

**Issue**:
`architecture/index.md:8-22` は "Installable App Model 5 章" として 5 page
を列挙: installable-app-model / takosumi-accounts / app-installation /
runtime-modes / installer-pipeline。

一方 `architecture/installable-app-model.md` は "5 entity 責務分離"
(Takosumi Accounts / takosumi-git / takosumi kernel / Installed Takos /
AppInstallation 台帳) として **異なる 5 = entity** を列挙。

**ページ数 5** と **entity 数 5** がどちらも "5" で偶然一致しているため、
読者は両者が同じものを指していると誤解しやすい。

**Repair**:
- `architecture/index.md:8` の見出し
  `## Installable App Model 5 章` → `## Installable App Model 章 (5 page)`
  に変更し、明示的に "ページ数" であることを示す。
- 担当 Wave: W3.B1 (architecture)。

---

### I-01: `apps/oidc-consumer.md:181-184` の `/oauth/*` route 表は **正本ページ側 endpoint** の説明として OK

**Label**: Info
**Files**:
- `/home/tako/Desktop/takos/takos/docs/apps/oidc-consumer.md`

**Issue / Note**:
`/oauth/authorize`, `/oauth/token`, `/oauth/consent`, `/oauth/device` の
記述は、Takos から削除されて Takosumi Accounts に集約された旨を明示する
ための rename map であり、新モデルに整合している。grep で検出したが
誤検出。

**Repair**: 不要。

---

### I-02: `operator/bootstrap.md:158-162` の legacy `/oauth/*` server 言及

**Label**: Info
**Files**:
- `/home/tako/Desktop/takos/takos/docs/operator/bootstrap.md`

**Issue / Note**:
`L157` `::: warning Takos OAuth issuer は立ち上げない` 以下で legacy 移行
ガイドとして言及しており、deprecation note との並置として正しい。grep で
検出したが誤検出。

**Repair**: 不要。

---

### I-03: `reference/api.md` (Wave 対象外) には旧 `/oauth/*` route が **多数残存**

**Label**: Info
**Files**:
- `/home/tako/Desktop/takos/takos/docs/reference/api.md` (本 review の対象
  39 ファイルには **含まれない**)

**Issue / Note**:
`reference/api.md:454, 2152-2221` で `/oauth/authorize`, `/oauth/token`,
`/oauth/device`, `/oauth/device/code` などの旧 route 表が **削除・
deprecation 注記なしに残っている**。本 plan の Wave 1-3 は `reference/api.md`
を含めていないため形式上 finding ではないが、**ecosystem 全体の整合性
としては Block 級の負債**。

**Repair**:
- 本 plan のスコープ外。後続の plan で `reference/api.md` を
  Installable App Model 整合に書き換える必要あり。エスカレーション対象。

---

## 検査メソド

1. `grep -rEn "Takos\\s*の\\s*OAuth\\s*server"` 系で旧用語検出 → 39
   ファイル中 0 ヒット (operator/bootstrap.md / oauth-setup.md は
   "(legacy)" / "deprecated" バナー付きで OK)。
2. `grep -rEn "/oauth/(authorize|token|consent|device)"` → reviewed 39
   files 内では `apps/oauth.md` (deprecated バナー付き),
   `apps/oidc-consumer.md` (移行 map), `architecture/takosumi-accounts.md`
   (issuer endpoint 表), `operator/oauth-setup.md` (legacy 互換表),
   `platform/road-to-1.0.md` (Phase 1/4 の DoD) はすべて契約 (legacy /
   issuer / migration) と整合しており Block ではない。
3. kernel features 列挙 → `architecture/index.md:28`,
   `architecture/system-architecture.md:97`, `architecture/kernel.md:38-43`,
   `architecture/control-plane.md:248-249` の 4 ページで
   `Agent / Chat, Git, Storage, Store, Deploy, Routing, Resources` の 7
   項目で **完全に一致**。`Auth` / `Billing` は 4 ページで一貫して除外。
4. `.takosumi/app.yml` (installer-bound) vs `.takosumi/manifest.yml`
   (kernel-bound) の二段構造 → `deploy/manifest.md`,
   `deploy/environment.md`, `deploy/deploy.md`, `deploy/deploy-group.md`,
   `get-started/project-structure.md`, `reference/manifest-spec.md`,
   `reference/app-yml-spec.md` で **正しく区別**。`.takos/app.yml` への
   参照はすべて "(deprecated alias)" と並置されており current として
   扱っている箇所はない。
5. VitePress build (`deno task docs:build`) → **green**, broken
   internal link 0 件。
6. 6 binding type 列挙 → `reference/binding-catalog.md:34-39` (canonical),
   `reference/app-yml-spec.md:201-206` (列挙), `apps/oidc-consumer.md`
   (`identity.oidc@v1`), `apps/install-paths.md` (cross-ref) で **完全
   一致**。
7. 3 runtime mode (`shared-cell` / `dedicated` / `self-hosted`) →
   `runtime-modes.md`, `installable-app-model.md`, `install-paths.md`,
   `platform/billing.md`, `platform/compatibility.md` で **完全一致**。
8. 3 install path (`Use Takos` / `Install from Git` / `Self-host`) →
   `install-paths.md`, `get-started/index.md` (前半), `index.md` (top),
   `overview/index.md` で **完全一致** (B-03 候補だった
   get-started/index.md 後半は別 finding W-03 で追跡)。

---

## Status

**PASS (Round 1 修正済み)** — Wave 5 Round 1 repair で Block 2 件 / Warn 6 件
すべて適用済み。docs build green、grep regression なし、out-of-scope の I-03
(`reference/api.md`) のみエスカレーション継続。

### Round 1 修正サマリ (2026-05-07)

- **B-01 fixed**: `architecture/app-installation.md` に
  `### Transitional substates (in-flight phases)` 節を追加し、
  `installing` / `failed` の subset として 8 transitional substate
  (`upgrading` / `rolling-back` / `materializing` / `exporting` /
  `uninstalling` / `upgrade-failed` / `materialize-failed` / `deleted`) を
  正本化。外部公開 status は canonical 5 値固定で、`upgrade-export.md` /
  `install-api.md` の中間状態表現と整合。
- **B-02 fixed**: `architecture/control-plane.md` の routing 表から `auth` を
  削除し、auth (`/oauth/*`) は Takosumi Accounts (`accounts.takosumi.cloud`)
  が serve する旨の補足を追加。
- **W-01 fixed**: `architecture/installable-app-model.md` を "Auth と Billing
  を含めません" に揃え、Billing は Takosumi Cloud billing の責務と明記。
- **W-02 fixed**: `architecture/takosumi-accounts.md` の `/oauth/userinfo` 行に
  "OIDC standard requirement、`new.md` §8.1 の core list を実装上補完" 注記
  を追加 (Repair 推奨案 2)。
- **W-03 fixed**: `get-started/index.md` の "3 分で始める" 節を operator 限定
  guide として明示し、一般ユーザーは 3 install path (Use Takos / Install from
  Git / Self-host) と Takosumi Accounts OIDC を使う旨へ振り分け。"OAuth
  settings" tab 言及を `account settings → Personal Access Tokens` に変更。
- **W-04 fixed**: `platform/store.md` の "OAuth client" を
  "OIDC client (`identity.oidc@v1` AppBinding 経由)" に置換し、glossary の
  legacy entry へ link。
- **W-05 fixed**: `apps/launch-token.md` § "通常ログインとの違い" の比較表に
  `POST /v1/installations/{id}/launch-token` への明示 link を追加し、
  "次に読むページ" にも install-api への link を加筆。`reference/install-api.md`
  §3 の冒頭にも `apps/launch-token` 正本ページとの双方向参照ノートを追加。
- **W-06 fixed**: `architecture/index.md` の見出しを
  `## Installable App Model 章 (5 page)` に変更し、entity 数 5 と page 数 5
  の偶然の一致を本文で明示。

### Round 1 build / grep 結果

- `cd takos && deno task docs:build` → **green** (build complete in 7.40s)。
  `_*.md` (本 working report) は `srcExclude: ['**/_*.md']` で公開対象外に
  設定。
- `grep -rEn "Takos\s*の\s*OAuth\s*server"` → 0 hit。
- `grep -rEn "/oauth/(authorize|token)" | grep -v "deprecated|legacy|takosumi-accounts|oauth-setup"`
  → reviewed 39 files で **新規逸脱なし**。残存 hit はすべて Wave 4 で
  既知 (`apps/oauth.md` deprecated / `apps/oidc-consumer.md` rename map /
  `hosting/cloudflare.md` legacy / `road-to-1.0.md` migration DoD /
  `reference/api.md` は I-03 escalation 対象)。

### 残課題

- **I-03**: `reference/api.md` の旧 `/oauth/*` route 列挙は本 plan の
  scope 外。後続 plan で Installable App Model 整合に書き換える必要あり
  (ecosystem-level 負債としてエスカレーション継続)。

---

## Status (履歴)

旧 Status: **FAIL** (Block 2 件 / Warn 6 件)

Wave 5 で以下の優先順で repair pass を実施した:

1. **Round 1 (Block 解消)**:
   - B-01: `architecture/app-installation.md` に transitional substates
     節を追加し、3 ページで status enum 一致 (W3.B1 担当)。
   - B-02: `architecture/control-plane.md:261` の `auth` を削除
     (W3.B2 担当)。

2. **Round 2 (Warn 解消)**:
   - W-01: `architecture/installable-app-model.md:295` に Billing 追記。
   - W-02: `architecture/takosumi-accounts.md:106` の `/oauth/userinfo`
     行に注記。
   - W-03: `get-started/index.md:74-92` のユーザー導線整理。
   - W-04: `platform/store.md:225` の "OAuth client" を "OIDC client"
     に。
   - W-05: `apps/launch-token.md:76` に install-api への cross-ref
     強化。
   - W-06: `architecture/index.md:8` の見出し整理。

3. **Round 3 (再 review)**: 上記修正後に再度同 checklist を回し、Block /
   Warn が 0 になったら **PASS** に切り替え。`reference/api.md` の
   I-03 はスコープ外として user に escalate。

---

## Round 2 (Wave 6) 修正済み

- Block 1 件 / Warn 4 件 全て修正
- 修正概要:
  - Block (`reference/api.md` の `/oauth/*` route 残存): 冒頭に `::: warning Legacy / Migration in progress` deprecated banner を追加し、`oauth-consent` / `oauth-server` 両 family の見出しに **(legacy / deprecated)** マークと Takosumi Accounts / OIDC Consumer / Install API への移行先 link を追加。
  - Warn 1 (`platform/takos-docs.md`): "Takos OAuth callback" 記述を "OIDC callback (Takosumi Accounts 経由)" に変更し legacy 注記と OIDC Consumer link を併記。
  - Warn 2 (`platform/takos-excel.md`): 同上の方針で置換。
  - Warn 3 (`platform/takos-slide.md`): 同上の方針で置換。
  - Warn 4 (`apps/oidc-consumer.md`): 関連 env 表の直後に "## 関連 env (補助、本ページでは詳述しない)" 節を追加し、`DATABASE_URL` / `OBJECT_STORE_*` / `TAKOS_INSTALLATION_ID` / `BASE_URL` / `DEPLOY_INTENT_*` / `INSTALL_LAUNCH_*` の正本ページへ振り分け。
- Status: **PASS (Round 2)**

## Round 3 (Wave 10) 修正済み
- Block 2 件 / Warn 2 件 全修正
- Status: PASS (Round 3)
- 主な修正内容:
  - B-1 (`platform/index.md`): kernel features 列挙から `Auth` を削除し canonical 7 項目 (Agent / Chat, Git, Storage, Store, Deploy, Routing, Resources) に統一。"kernel が auth / principal" 表現を "OIDC discovery と principal の resolve を Takosumi Accounts に委譲" に書き換え、Auth 役割移管先を明示。
  - B-2 (`takosumi/descriptors/official-descriptor-set-v1.md`): L798-802 の "Takosumi Accounts" / `identity.oidc@v1` AppBinding / "Installable App Model" 直接言及を削除し、core descriptor set は compute substrate (kernel) のみを定義する旨と Binding Catalog への link に置換 (kernel-pure 方針維持)。
  - W-1 (`deploy/index.md`): L71 / L89 の `.takos/app.yml` を `.takosumi/manifest.yml` (kernel-bound) 主参照に置換し、`.takosumi/app.yml` (installer-bound) との二段構造説明と reference link を追加。
  - W-2 (`takosumi/descriptors/official-descriptor-set-v1.md` の `takos.api-key`): "app が API key を発行するときの compute-side primitive。上位 layer 側で managed / scoped される可能性" の scope 説明を 1-2 行追加し、上位 contract (scope / revoke / rotate) は Binding Catalog 参照と明記 (account plane 用語は直接言及せず抽象化)。

## Round 3 (Wave 11) 追加修正済み
- 6 file 全件修正 (Round 3 audit / Wave 10 後の最終 cleanup)
- Status: PASS (Round 3 final)
- 主な修正内容:
  - A-1 (`platform/index.md`): L26 table の Deploy Manifest 例を `.takosumi/manifest.yml` (kernel-bound) に置換、L32 本文の `.takos/app.yml` / `.takos/app.yaml` を `.takosumi/manifest.yml` を主とし旧 alias は deprecated 注記、L100 図中の deploy manifest 注釈を `.takosumi/manifest.yml` に置換。
  - A-2 (`platform/yurucommu.md`): L18 の「`.takos/app.yml` に置く」を kernel-bound `.takosumi/manifest.yml` + installer-bound `.takosumi/app.yml` 二段構造に書き換え、旧 alias は deprecated 注記。
  - A-3 (`platform/store.md`): L39 / L43 / L46-47 / L211 / L214 の `.takos/app.yml` / `.takos/app.yaml` 参照を `.takosumi/manifest.yml` に統一。Store の deployable 判定の正本 file 名を二段構造 current 名に揃えた。
  - B-1 (`takosumi/guides/authoring-guide.md`): L266-267 の "Installable App Model" / "AppBinding" / "Takosumi Accounts" 直接言及を削除し、core descriptor / kernel publication 拡張ルールに集中する記述に置換、上位 layer 仕様は Binding Catalog 参照に逃がした (kernel-pure 方針維持)。
- 検証:
  - `cd takos && deno task docs:build` → green (build complete in ~7s)
  - `cd takos && deno task validate:agent-docs` → passed
  - `cd takos && deno task validate:architecture` → passed (17 README/plan, 12 domain dirs)
  - grep 残骸: 対象 5 file 内では deprecated alias 注記行のみ残存、takosumi/ 配下では `AppBinding` / `Takosumi Accounts` / `Installable App Model` の直接言及 0 件 (kernel-pure 達成)

## Round 3 (Wave 13) 最終 cleanup

- 最終 grep audit で発見された 3 件の残存矛盾を absolute final として全件修正
- Status: **PASS (Round 3 absolute final)**
- 修正内容:
  - **A (`legal/data-residency.md` L50)**: Data Class Rules 表 "Account identity and authentication metadata" 行の "Takos account home region" を **"Takosumi Account home region"** に置換し、Takos が OIDC consumer として同 region に app-local profile を保持する旨を 1 文追記。Installable App Model の所有権モデル (Takosumi Accounts が account 主体、Takos は consumer app) に整合。
  - **B (`operator/oidc-setup.md` L27 / L57 / L81)**: `/auth/external` 残存 3 箇所を整理。env table 行の `AUTH_ALLOWED_REDIRECT_DOMAINS` 説明を "operator login の external service handoff (legacy compat path)" に書き換え、Takosumi Accounts 経由の現代モデルでは end user の OIDC redirect は `OIDC_REDIRECT_URI` (`/auth/oidc/callback`) のみで完結する旨を明示。Google OAuth の external callback URI ブロックは `# legacy compat` コメント付きで code block 内に保持し、新規 tenant は登録不要であることを本文で説明。L81 の "Public Origins" 節も同方針で書き換え (legacy 互換のために残す旨を明示)。
  - **C (`reference/api.md` L2129-L2130)**: `/auth/external/session` / `/auth/external/callback` の 2 行を auth (server-side) 表から削除。Wave 7 で `/oauth/*` legacy route を削除した方針と一貫させ、Installable App Model の現行 endpoint 集合 (`/auth/login` Google OAuth / `/auth/password` / `/auth/cli` / `/auth/link/google` ペア) のみを残した。`/auth/oidc/*` end-user route は OIDC Consumer 正本ページ (`apps/oidc-consumer.md`) 側で扱う。
  - **副次 (`apps/oidc-consumer.md` L197)**: 削除された OAuth route 表の `/auth/external` 行を `/auth/external` (legacy) と明示し、grep filter (`legacy` exclude) と整合させた。rename map としての記述は維持。
- 検証:
  - `cd takos && deno task docs:build` → green (build complete in 7.68s)
  - `cd takos && deno task validate:agent-docs` → passed
  - `cd takos && deno task validate:architecture` → passed (17 README/plan, 12 domain dirs)
  - grep 残骸 (両 query):
    - `Takos\s*account\b` (filter: `_consistency|deprecated|legacy|削除|Takosumi Account|profile` 除外) → **0 hit**
    - `/auth/external` (filter: `_consistency|deprecated|legacy` 除外) → **0 hit**
- これにより Installable App Model の用語境界 (Takos account → Takos profile (app-local) または Takosumi Account / `/auth/external` → `/auth/oidc/login` + `/auth/oidc/callback`) が docs 全体で完全達成。kernel features への "Auth" 混入もなく、kernel-pure 方針も維持。
