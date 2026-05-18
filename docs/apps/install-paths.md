# インストール方法

> このページでわかること: Takos を使い始める 3 つの方法と、それぞれの対象読者。

Takos には 3 つの始め方があります:

- **Use Takos** — 一般ユーザー向け。operator が public signup を開いた場合に最短で使い始められる
- **Install from Git** — アプリ開発者向け。Git URL からアプリをインストール
- **Self-host** — オペレーター向け。自分のサーバーで Takos を運用

::: warning Managed offering gate
`Use Takos` と managed `Install from Git` は local / staged rehearsal path として実装済みですが、public managed
offering は private readiness bundle、`acceptedReady: true` topology reports、`ready: true` public summary、saved
live audit、canonical digest、separate operator approval、sanitized public summary が揃い、
`managed-offering:status` が `canOpenManagedOffering: true` を返すまで closed です。Self-host path はこの public managed
offering gate とは別に使えます。
:::

::: tip 関連ページ
Runtime mode の詳細は [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)、
インストールの内部処理は [Installer Pipeline](https://github.com/tako0614/takosumi/blob/master/docs/reference/installer-api.md) を参照してください。
:::

## 1. 3 path 一覧

| path               | target user                       | runtime mode                     | install 入口                                                                 | UX                                                  |
| ------------------ | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `Use Takos`        | 一般ユーザー / 試したい人         | `shared-cell`                    | operator Accounts の `/start?takos_url=...` ボタン                           | public signup open 後に Account / Space 作成 → chat |
| `Install from Git` | 開発者 / 透明性重視 / fork 利用者 | `shared-cell` または `dedicated` | operator-selected install UI (`https://<OPERATOR_INSTALL_HOST>/install?...`) | app dry-run 確認 → build → deploy                   |
| `Self-host`        | 退出 / 企業 / 主権重視            | `self-hosted`                    | operator deploy + app export/import                                          | 自前 takosumi で運用                                |

`Install from Git` と app export/import は同じ Installation contract 上に設計されています。current implementation
は ledger / API / local proof までで、public managed offering での live data copy / clean self-host restore は
launch-readiness evidence の対象です (詳細は
[Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md))。

## 2. Use Takos (instant managed install)

最速 path。operator が public signup を開いた後は、ユーザーが意識するのは `Use Takos` ボタン 1 回だけ。
closed gate の間、この path は operator-owned rehearsal / local validation の対象です。

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

- Takos 本体は operator が運用する共有 runtime に接続されます
- Takosumi Accounts に launch installation 行が作られ、OIDC client が払い出されます
- バンドルアプリの Installation が `mode: shared-cell` で作成されます
- インストールごとに専用のデータ領域が確保されます
- 課金は Takosumi Account の Takos プランに line item として記録されます

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

### 2.3 Materialize / export contract

operator-opened `Use Takos` で作られた Space の bundled / third-party app installation
も同じ Installation contract に乗ります。`takosumi materialize` /
`takosumi export` は current contract / rehearsal 対象であり、
operator-opened flow で live data portability を保証するものではありません。

## 3. Install from Git

Git URL を指定して app を install する path。App の transparency と
custom fork 利用を可能にする。

### 3.1 流れ

```txt
README / operator-selected install UI
  ↓ Install App ボタン
https://<OPERATOR_INSTALL_HOST>/install?git=...&ref=v1.2.3
  ↓
Takosumi Account 作成 / login
  ↓
install dry-run を表示
  - source commit / publisher verification
  - requested bindings / grants
  - estimated cost
  ↓ approve
Takosumi installer の 5 endpoint lifecycle
  ↓
Installation ready
  ↓
launch token → chat
```

dry-run / apply の詳細は
[Installer API](https://github.com/tako0614/takosumi/blob/master/docs/reference/installer-api.md)
を参照。

### 3.2 ボタン例

app repo の install ボタン (operator / self-host instance で base URL が変わります):

```html
<a
  href="https://<OPERATOR_INSTALL_HOST>/install?git=https://github.com/example/my-app&ref=v1.2.3"
>
  Install App
</a>
```

README の badge:

```md
[![Install App](https://<OPERATOR_INSTALL_HOST>/badges/install-app.svg)](https://<OPERATOR_INSTALL_HOST>/install?git=https://github.com/example/my-app&ref=v1.2.3)
```

fork した派生版を配る場合も同じ形。`git=` と `ref=` を fork 側に差し替えるだけで
install できる。

### 3.3 ref pin 必須 (`ref=main` 禁止)

`Install from Git` の URL は **必ず tag か commit に pin** する。 `ref=main` /
`ref=latest` のような移動 ref は takosumi installer が拒否する。

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

- Installation 行に `sourceCommit` を記録するため、ref が動くと 「install
  したものの正体」を後から説明できなくなる。
- supply chain attack 検知 (突然 commit が変わったら incident) が pin
  なしでは成立しない。
- upgrade / rollback 時に「何から何へ移ったか」が pin なしでは曖昧になる。

正規化の振る舞い:

- tag を渡すと installer は SHA に解決し、Installation 行に
  `sourceRef: v1.2.3` / `sourceCommit: 7f3c9...` の両方を保存する。
- 同じ tag を後から force-push されても installation は影響を受けない
  (`sourceCommit` で pin されているため)。

## 4. Self-host

current operator 依存を切る path。利用者自身が Takosumi instance と Takos
product distribution を運用し、 bundled / third-party app installation bundle
をそこに import する。

### 4.1 流れ (新規 install の場合)

```bash
git clone https://github.com/example/my-app
takosumi install ./my-app --ref v1.2.3 --accounts-url https://my-takosumi.example.com
```

または既存 installation を export してから:

```bash
takosumi export inst_abc --output takos-export.tar.zst
takosumi import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
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
| 試したいだけ / 一般ユーザー                     | public signup が開いている operator の `Use Takos`           |
| 開発者で source を読んでから install したい     | `Install from Git`                                           |
| fork や派生版を install したい                  | `Install from Git`                                           |
| 専有 runtime / 高負荷耐性が要る                 | `Install from Git` (mode=dedicated) または後から materialize |
| 企業 / コンプライアンス要件で自社境界に置きたい | `Self-host`                                                  |
| Takosumi Cloud 依存を完全に切りたい             | `Self-host`                                                  |

3 path は同じ ownership model に収束する設計です。ただし current docs では
environment cutover や dedicated runtime 採用を約束する案内として扱いません。live data portability は provider adapter
と launch-readiness evidence が揃った operator だけが宣言できます。

## 6. 既存 "はじめる" への導線

本ページは install path の選択ガイドであり、各 path 内部の最初の作業は
"はじめる" 章で扱う:

- operator-opened `Use Takos` を選んだ後の chat 開始 → [はじめる](/get-started/)
- `Install from Git` を選んだ後の最初のアプリ →
  [最初のアプリ](/get-started/your-first-app)
- `Self-host` を選んだ後の repo 構造の理解 →
  [プロジェクト構成](/get-started/project-structure)

逆に、すでに "はじめる" を読んでいて install path の意味を確認したい
読者は本ページに戻ってくる前提。

## 次に読むページ

- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
  各 path が着地する `shared-cell` / `dedicated` / `self-hosted` の物理構造。
- [Installer Pipeline](https://github.com/tako0614/takosumi/blob/master/docs/reference/installer-api.md)
  `Install from Git` で実行される 13 step の pipeline。
- [.takosumi.yml spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
  install 対象 repo に置く installer-bound manifest。
- [はじめる](/get-started/) path 選択後の最初の作業。
- [Upgrade / Export](/platform/upgrade-export) path 間の乗り換えと export bundle
  の運用。
