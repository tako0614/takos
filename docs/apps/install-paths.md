# インストール方法

> このページでわかること: Takos を使い始める入口と、Git URL から app を追加する入口の違い。

Takos の主役は Workspace です。最初に得る成果は、Apps launcher に app が並び、Chat で agent に作業を頼めて、memory / Git /
files に結果が残ることです。OpenTofu や Takosumi の ledger は、その成果を安全に install / update / audit するための裏側です。

## Public hosted flow target

Takos の public hosted 導線は次の 1 本に寄せます。public hosted Takosumi access が closed の間は、同じ flow を
operator-owned rehearsal 環境で検証し、Self-host path はこの public platform access gate とは別に使えます。

```txt
takos.jp
  ↓ Use Takos / Install from Git
https://app.takosumi.com/install?git=https://github.com/tako0614/takos.git&ref=<release-tag-or-commit>&path=deploy/opentofu
  ↓ client-handled prefill
https://app.takosumi.com/new
  ↓ sign in / Workspace / compatibility check / provider binding / explicit approval
Capsule plan → apply
  ↓
Takos launch URL / Apps launcher / Chat
```

`/install` は install API ではありません。dashboard が query を `/new` に引き継ぐ prefill route で、ユーザーは必ず source
summary、compatibility check、plan、apply の確認を通ります。

public GA では takos.jp の CTA が `main` のような moving ref ではなく、release tag または commit SHA を指していることを確認します。
operator は `takos/website` build 時に `VITE_TAKOS_INSTALL_REF` を設定して pin します。

## 3 つの入口

| path               | target user                    | まず起きること                                       |
| ------------------ | ------------------------------ | ---------------------------------------------------- |
| `Use Takos`        | 一般ユーザー / 試したい人      | account 作成 → Workspace → bundled apps → chat       |
| `Install from Git` | app 開発者 / fork 利用者       | Git URL を確認 → app を追加 → Apps launcher に表示   |
| `Self-host`        | 企業 / 主権重視 / 退出したい人 | 自分の origin に Takos distribution worker を deploy |

`Use Takos` と `Self-host` は Takos product を使い始める入口です。`Install from Git` は、Workspace に app を追加する入口です。

## Use Takos

operator が public signup を開いた場合の最短 path です。

```txt
Takos landing / operator site
  ↓ Use Takos
account 作成
  ↓
Workspace 作成
  ↓
bundled apps seed
  ↓
Apps / Chat / Memory を使い始める
```

ユーザーが最初に確認するのは、app が開けること、chat が使えること、agent の成果が Workspace に残ることです。

## Install from Git

Git URL の app を Workspace に追加する path です。Store / Source 画面は中央の公式 registry ではなく、Git URL の OpenTofu
Capsule を見つけて追加するための discovery surface です。

```txt
Git URL / ref / module path
  ↓
app summary と作られるものを確認
  ↓
承認
  ↓
Apps launcher に表示
```

production install は tag または commit に pin します。moving ref (`main`, `latest`, `HEAD`) は operator policy で拒否できます。

## Self-host

Self-host は Takos distribution worker を自分の origin で動かす path です。`takos/deploy/opentofu` が Takos product の
backing resources を作り、wrangler が worker artifact を上げます。Accounts / deploy-control / dashboard / OpenTofu runner は、
self-hoster または operator が運用する外部 Takosumi control plane が所有します。

Self-host operator が決めるもの:

- Cloudflare account / zone / D1 / R2 / KV / Queues などの backing resources
- account / OIDC / domain / billing / backup policy
- provider credentials と data boundary
- Workspace / Connection / app install policy

## どれを選ぶか

| あなたが...                                      | 選ぶ path                                          |
| ------------------------------------------------ | -------------------------------------------------- |
| すぐに試したい                                   | public signup が開いている operator の `Use Takos` |
| 自分の app / fork を入れたい                     | `Install from Git`                                 |
| app source を確認してから使いたい                | `Install from Git`                                 |
| provider credentials と data boundary を持ちたい | `Self-host`                                        |
| hosted operator から退出したい                   | export / import を使って self-host へ移す          |

## 次に読むページ

- [はじめる](/get-started/)
- [はじめてのアプリ](/get-started/your-first-app)
- [Git URL からアプリを install する](/platform/store)
- [Self-host / deploy](/deploy/)
