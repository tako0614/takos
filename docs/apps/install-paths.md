# Install Paths

Takos は同じ AppInstallation model の上に **3 種類の install path** を
提供する。一般ユーザーが instant に始める `Use Takos`、Git URL から 透明に
install する `Install from Git`、そして自前環境に持ち込む
`Self-host`。本ページは、どの path をどんな読者が選ぶか、各 path の流れ、README
やランディングページに置くボタン例、そして既存の "はじめる"
章への導線をまとめる。

::: info このページで依存してよい範囲 / してはいけない範囲

- 依存してよい: 3 path の name (`Use Takos` / `Install from Git` / `Self-host`)
  と target audience の対応、URL `takosumi.cloud/install?...` の形、`ref` は tag
  / commit に pin する規律、ボタン HTML の正本形。
- 依存してはいけない: 各 path の internal binding default 値、 shared-cell 上の
  cell 配置、self-host 先の OIDC issuer の選定基準。 これらは
  [Runtime Modes](/architecture/runtime-modes) と
  [Installer Pipeline](/architecture/installer-pipeline)、及び利用者の
  運用方針に従う。

:::

## 1. 3 path 一覧

| path               | target user                       | runtime mode                     | install 入口                             | UX                              |
| ------------------ | --------------------------------- | -------------------------------- | ---------------------------------------- | ------------------------------- |
| `Use Takos`        | 一般ユーザー / 試したい人         | `shared-cell`                    | takos.jp の `Use Takos` ボタン           | Takosumi Account 作成 → 即 chat |
| `Install from Git` | 開発者 / 透明性重視 / fork 利用者 | `shared-cell` または `dedicated` | `takosumi.cloud/install?git=...&ref=...` | preview 確認 → build → deploy   |
| `Self-host`        | 退出 / 企業 / 主権重視            | `self-hosted`                    | `takosumi-git install` CLI               | 自前 takosumi で運用            |

3 path は Installable App Model の同じ AppInstallation 行に着地するため、 途中で
path を乗り換えても所有・data namespace を持ったまま次の mode に materialize /
export できる (詳細は [Runtime Modes](/architecture/runtime-modes))。

## 2. Use Takos (instant managed install)

最速 path。ユーザーが意識するのは `Use Takos` ボタン 1 回だけ。

### 2.1 流れ

```txt
takos.jp
  ↓ Use Takos
Takosumi Account 作成 / login
  ↓
shared-cell に AppInstallation 作成
  ↓
launch token JWS 発行
  ↓
takos.jp/chat (or takos-acct123.takosumi.app) に即遷移
  ↓
chat 開始
```

裏側では:

- `appId: takos.chat` の AppInstallation が `mode: shared-cell` で作られる
- OIDC client binding が service identifier `takosumi.account.auth@v1`
  で解決される Takosumi Accounts に作成される
- per-installation data namespace が確保される
- billing は Takosumi Account に紐づく Takos plan として line item 化

### 2.2 ボタン例

```html
<a href="https://takosumi.cloud/start?app=takos.chat">
  Use Takos
</a>
```

`takos.jp` の hero ボタンや、ブログの「今すぐ試す」CTA に置く。

### 2.3 後から乗り換えられる

`Use Takos` で始めた installation は、後から
`takosumi-git materialize inst_abc --mode dedicated` で `dedicated` に物理化
したり、`takosumi-git export inst_abc` で `self-hosted` に export できる。
最初の選択は不可逆ではない。

## 3. Install from Git

Git URL を指定して install する path。InstallableApp の transparency と custom
fork 利用を可能にする。

### 3.1 流れ

```txt
README / takosumi.cloud
  ↓ Install Takos ボタン
takosumi.cloud/install?git=...&ref=v1.2.3
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
[Installer Pipeline](/architecture/installer-pipeline) を参照。

### 3.2 ボタン例

公式 Takos の install ボタン:

```html
<a
  href="https://takosumi.cloud/install?git=https://github.com/takos/takos&ref=v1.2.3"
>
  Install Takos
</a>
```

README の badge:

```md
[![Install Takos](https://takosumi.cloud/badges/install-takos.svg)](https://takosumi.cloud/install?git=https://github.com/takos/takos&ref=v1.2.3)
```

fork した派生版を配る場合も同じ形。`git=` と `ref=` を fork 側に
差し替えるだけで install できる。

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

完全退出。利用者自身が takosumi インスタンスを運用し、Takos を そこに install
する。

### 4.1 流れ (新規 install の場合)

```bash
git clone https://github.com/takos/takos
takosumi-git install ./takos --ref v1.2.3 --to https://my-takosumi.example.com
```

または既存 installation を export してから:

```bash
takosumi-git export inst_abc --output takos.bundle
takosumi-git install ./takos.bundle --to https://my-takosumi.example.com \
  --auth-issuer https://keycloak.example.com/realms/takos
```

### 4.2 self-host が決めるもの

`Use Takos` / `Install from Git` では Takosumi Cloud が決めていた値を、
self-host では利用者が決める:

- OIDC issuer (Keycloak / Authentik / Auth0 / Clerk / Supabase Auth / 任意 OIDC)
- database / object store の provider
- domain と TLS の運用
- backup / DR 戦略
- billing (Takosumi Cloud は関与しない)

詳細は [Runtime Modes § self-hosted への export](/architecture/runtime-modes) と
[Upgrade / Export](/platform/upgrade-export) を参照。

## 5. どの path をいつ選ぶか

| あなたが...                                     | 選ぶ path                                                    |
| ----------------------------------------------- | ------------------------------------------------------------ |
| 試したいだけ / 一般ユーザー                     | `Use Takos`                                                  |
| 開発者で source を読んでから install したい     | `Install from Git`                                           |
| fork や派生版を install したい                  | `Install from Git`                                           |
| 専有 runtime / 高負荷耐性が要る                 | `Install from Git` (mode=dedicated) または後から materialize |
| 企業 / コンプライアンス要件で自社境界に置きたい | `Self-host`                                                  |
| Takosumi Cloud 依存を完全に切りたい             | `Self-host`                                                  |

3 path は排他ではなく、**`Use Takos` で始めた installation を後から `Self-host`
に export する** といった連続的な乗り換えが想定されている。
最初の選択を間違えても所有権と data はそのまま持ち越せる。

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

- [Runtime Modes](/architecture/runtime-modes) 各 path が着地する `shared-cell`
  / `dedicated` / `self-hosted` の物理構造。
- [Installer Pipeline](/architecture/installer-pipeline) `Install from Git`
  で実行される 13 step の pipeline。
- [.takosumi/app.yml spec](/reference/app-yml-spec) install 対象 repo に置く
  installer-bound manifest。
- [はじめる](/get-started/) path 選択後の最初の作業。
- [Upgrade / Export](/platform/upgrade-export) path 間の乗り換えと export bundle
  の運用。
