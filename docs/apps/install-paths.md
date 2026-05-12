# Install Paths

Takos は users / app developers / operators 向けに **3 種類の entry path** を
提供する。一般ユーザーが instant に始める `Use Takos`、bundled / third-party app
を Git URL から透明に install する `Install from Git`、そして Takos product
distribution と app export bundle を自前環境に持ち込む `Self-host`。Takos は
Takosumi 上で動く self-hostable な AI-first chat & agent product であり、
`chat / agent / memory / space` を core 機能として持つ。 本ページは、どの path
をどんな読者が選ぶか、各 path の流れ、README や
ランディングページに置くボタン例、そして既存の "はじめる" 章への導線をまとめる。

::: info このページで依存してよい範囲 / してはいけない範囲

- 依存してよい: 3 path の name (`Use Takos` / `Install from Git` / `Self-host`)
  と target audience の対応、operator-selected Accounts URL (例:
  `/start?takos_url=...`) と install UI URL (managed example:
  `takosumi.cloud/install?...`) の形、`ref` は tag / commit に pin
  する規律、ボタン HTML の正本形。
- 依存してはいけない: 各 path の internal binding default 値、 shared-cell 上の
  cell 配置、self-host 先の OIDC issuer の選定基準。 これらは
  [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
  と
  [Installer Pipeline](https://github.com/tako0614/takosumi-git/blob/master/docs/architecture/installer-pipeline.md)、及び利用者の
  運用方針に従う。

:::

## 1. 3 path 一覧

| path               | target user                       | runtime mode                     | install 入口                                                                 | UX                                      |
| ------------------ | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| `Use Takos`        | 一般ユーザー / 試したい人         | `shared-cell`                    | operator Accounts の `/start?takos_url=...` ボタン                           | Takosumi Account / Space 作成 → 即 chat |
| `Install from Git` | 開発者 / 透明性重視 / fork 利用者 | `shared-cell` または `dedicated` | operator-selected install UI (managed example: `takosumi.cloud/install?...`) | app preview 確認 → build → deploy       |
| `Self-host`        | 退出 / 企業 / 主権重視            | `self-hosted`                    | operator deploy + app export/import                                          | 自前 takosumi で運用                    |

`Install from Git` と app export/import は Installable App Model の同じ
AppInstallation 行に着地するため、途中で path を乗り換えても所有・data namespace
を持ったまま次の mode に materialize / export できる (詳細は
[Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md))。

## 2. Use Takos (instant managed install)

最速 path。ユーザーが意識するのは `Use Takos` ボタン 1 回だけ。

### 2.1 流れ

```txt
Takos landing / operator site
  ↓ Use Takos
Takosumi Accounts /start
  ↓
Takosumi Account / Space 作成
  ↓
Takos product opaque launch token 発行
  ↓
Takos /_takosumi/launch に遷移
  ↓
Space 作成 + bundled apps auto-install
  ↓
chat 開始
```

裏側では:

- Takos product は product-managed shared-cell runtime に接続される
- Accounts は必要に応じて product-managed launch installation row を作る。
  `source.gitUrl: takos-product://managed/takos` は operator-managed prebuilt
  Takos runtime の source pin であり、通常の Git URL InstallableApp ではなく
  `takosumi-git install` apply も通らない
- bundled apps の AppInstallation が必要に応じて `mode: shared-cell` で作られる
- OIDC client binding が `operator.identity.oidc` namespace export で解決される
  Takosumi Accounts に作成される
- per-installation data namespace が確保される
- billing は Takosumi Account に紐づく Takos plan として line item 化

### 2.2 ボタン例

```html
<a
  href="https://accounts.example.com/start?takos_url=https%3A%2F%2Ftakos.example.com"
>
  Use Takos
</a>
```

`accounts.example.com` は operator が選ぶ Takosumi Accounts
host、`takos.example.com` は launch 先の Takos host の例。特定の
`accounts.takosumi.cloud` hostname に依存しない。

### 2.3 後から乗り換えられる

`Use Takos` で作られた Space の bundled / third-party app installation
は、後から `takosumi-git materialize inst_abc --mode dedicated` で `dedicated`
に物理化したり、 `takosumi-git export inst_abc` で `self-hosted` に export
できる。最初の選択は 不可逆ではない。

## 3. Install from Git

Git URL を指定して app を install する path。InstallableApp の transparency と
custom fork 利用を可能にする。

### 3.1 流れ

```txt
README / operator-selected install UI
  ↓ Install App ボタン
takosumi.cloud/install?git=...&ref=v1.2.3  (managed example)
  ↓
Takosumi Account 作成 / login
  ↓
install preview を表示
  - source commit / publisher verification
  - requested bindings / grants
  - estimated cost
  ↓ approve
takosumi-git の install pipeline (13 step)
  ↓
AppInstallation ready
  ↓
launch token → chat
```

preview / pipeline の詳細は
[Installer Pipeline](https://github.com/tako0614/takosumi-git/blob/master/docs/architecture/installer-pipeline.md)
を参照。

### 3.2 ボタン例

app repo の install ボタン (managed example。operator / self-host instance では
base URL が変わります):

```html
<a
  href="https://takosumi.cloud/install?git=https://github.com/example/my-app&ref=v1.2.3"
>
  Install App
</a>
```

README の badge:

```md
[![Install App](https://takosumi.cloud/badges/install-app.svg)](https://takosumi.cloud/install?git=https://github.com/example/my-app&ref=v1.2.3)
```

fork した派生版を配る場合も同じ形。`git=` と `ref=` を fork 側に差し替えるだけで
install できる。

### 3.3 ref pin 必須 (`ref=main` 禁止)

`Install from Git` の URL は **必ず tag か commit に pin** する。 `ref=main` /
`ref=latest` のような移動 ref は takosumi-git installer が拒否する。

```txt
良い:
  ref=v1.2.3
  ref=v1.2.3-rc1
  commit=7f3c9a4d8e1b...

悪い:
  ref=main      ← 拒否
  ref=latest    ← 拒否
  ref=HEAD      ← 拒否
```

理由:

- AppInstallation 行に `sourceCommit` を記録するため、ref が動くと 「install
  したものの正体」を後から説明できなくなる。
- supply chain attack 検知 (突然 commit が変わったら incident) が pin
  なしでは成立しない。
- upgrade / rollback 時に「何から何へ移ったか」が pin なしでは曖昧になる。

正規化の振る舞い:

- tag を渡すと installer は SHA に解決し、AppInstallation 行に
  `sourceRef: v1.2.3` / `sourceCommit: 7f3c9...` の両方を保存する。
- 同じ tag を後から force-push されても installation は影響を受けない
  (`sourceCommit` で pin されているため)。

## 4. Self-host

完全退出。利用者自身が Takosumi instance と Takos product distribution
を運用し、 bundled / third-party app installation bundle をそこに import する。

### 4.1 流れ (新規 install の場合)

```bash
git clone https://github.com/example/my-app
takosumi-git install ./my-app --ref v1.2.3 --to https://my-takosumi.example.com
```

または既存 installation を export してから:

```bash
takosumi-git export inst_abc --output takos.bundle
takosumi-git install ./takos.bundle --to https://my-takosumi.example.com
```

### 4.2 self-host が決めるもの

`Use Takos` / `Install from Git` の managed default では operator
が決めていた値を、self-host では利用者が operator として決める:

- Takosumi Accounts issuer (Keycloak / Authentik / Auth0 / Clerk / Supabase Auth
  等は upstream IdP)
- database / object store の provider
- domain と TLS の運用
- backup / DR 戦略
- billing (self-host operator の BillingPort が持つ)

詳細は
[Runtime Modes § self-hosted への export](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
と [Upgrade / Export](/platform/upgrade-export) を参照。

## 5. どの path をいつ選ぶか

| あなたが...                                     | 選ぶ path                                                    |
| ----------------------------------------------- | ------------------------------------------------------------ |
| 試したいだけ / 一般ユーザー                     | `Use Takos`                                                  |
| 開発者で source を読んでから install したい     | `Install from Git`                                           |
| fork や派生版を install したい                  | `Install from Git`                                           |
| 専有 runtime / 高負荷耐性が要る                 | `Install from Git` (mode=dedicated) または後から materialize |
| 企業 / コンプライアンス要件で自社境界に置きたい | `Self-host`                                                  |
| Takosumi Cloud 依存を完全に切りたい             | `Self-host`                                                  |

3 path は排他ではなく、**`Use Takos` で作られた Space と bundled app
installation を後から `Self-host` に export する** といった連続的な乗り換えが
想定されている。 最初の選択を間違えても所有権と data はそのまま持ち越せる。

## 6. 既存 "はじめる" への導線

本ページは install path の選択ガイドであり、各 path 内部の最初の作業は
"はじめる" 章で扱う:

- `Use Takos` を選んだ後の chat 開始 → [はじめる](/get-started/)
- `Install from Git` を選んだ後の最初のアプリ →
  [最初のアプリ](/get-started/your-first-app)
- `Self-host` を選んだ後の repo 構造の理解 →
  [プロジェクト構成](/get-started/project-structure)

逆に、すでに "はじめる" を読んでいて install path の意味を確認したい
読者は本ページに戻ってくる前提。

## 次に読むページ

- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
  各 path が着地する `shared-cell` / `dedicated` / `self-hosted` の物理構造。
- [Installer Pipeline](https://github.com/tako0614/takosumi-git/blob/master/docs/architecture/installer-pipeline.md)
  `Install from Git` で実行される 13 step の pipeline。
- [.takosumi/app.yml spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
  install 対象 repo に置く installer-bound manifest。
- [はじめる](/get-started/) path 選択後の最初の作業。
- [Upgrade / Export](/platform/upgrade-export) path 間の乗り換えと export bundle
  の運用。
