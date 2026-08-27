# Workspace

> このページでわかること: Takos Workspace の正本モデルと、旧 `space` 永続化語彙の境界。

Takos の **Workspace** は chat、agent、memory、Git repository、app launcher、MCP tools をまとめる
private な作業領域です。認証済みの一つの外部 subject は Takos 内の一つの Principal に対応し、その Principal は
default Workspace と追加作成した複数の Workspace を所有できます。

```txt
external subject
  └─ Takos Principal
       ├─ default Workspace
       ├─ private Workspace
       └─ private Workspace
```

各 Workspace の authority は一つの Principal だけが持ちます。Takos Workspace は共同利用、招待、権限段階、
owner transfer を持ちません。agent や service は独立した Workspace owner ではなく、実行時にその Principal の
現在の authority から必要な capability だけを受け取ります。

Takosumi にも Workspace がありますが、Takosumi 側の共同利用設定は外部 integration の authority です。
それだけを根拠に Takos 内の Workspace access を付与することはありません。

## Default Workspace

Principal の作成時に default Workspace を用意します。`GET /api/me/personal-space` と `/api/spaces/me` はこの
Workspace を解決する互換 endpoint / selector です。default Workspace は削除できません。

## HTTP contract

current transport は互換性のため `/api/spaces` を維持しています。Workspace response は次の product data だけを返します。

- `id`, `name`, `slug`, `description`
- `is_default`
- `security_posture`
- `created_at`, `updated_at`

Workspace の種類や利用者別の権限を表す field は公開しません。Workspace selector と名前は core で非空・長さ制限を検証し、
list / resolve / update / delete はすべて authenticated Principal の owner scope に閉じます。

## Persistence compatibility

旧 schema の `accounts` と `account_memberships` は、migration compatibility と integrity witness のためだけに
Worker SQL adapter の内側へ残っています。これらは current domain model ではありません。

adapter が Workspace access を認めるのは、次のすべてが同時に成立するときだけです。

1. Principal row が存在し、active である。
2. Workspace row が active で、その `owner_account_id` が Principal と一致する。
3. 同じ Principal を指す active owner witness が存在する。

旧 row に別の値を追加したり、owner witness を偽装したりしても authority は増えません。suspended row や不一致 row は
fail closed です。

## Git state

Workspace の作成時に空の default repository は自動作成しません。`POST /api/spaces` と
`GET /api/spaces/:spaceId` も repository record を埋め込みません。Git は明示的に作成または install した capability
（通常は `takos-git` の Interface）として接続します。

旧 version で作成済みの repository row はこの cutover では削除しません。Workspace lifecycle と repository lifecycle は
別に保ちます。

## Runtime capability

Principal owner proof を実行時に再検証した後だけ、Workspace の tool executor に capability を渡します。

`storage.read/write` / `repo.read/write` / `egress.http` / `oauth.exchange` /
`vectorize.write` / `queue.write` / `analytics.write` / `workflow.invoke` /
`durable_object.use` / `billing.meter`

queued Run は作成時の requester Principal を必須とし、欠落している旧 Run から Workspace owner を推測しません。
Principal または owner witness が無効になった場合も、dispatch と tool bootstrap は fail closed です。

## 課金との関係

請求主体は operator account plane（リファレンス実装: Takosumi Accounts）/ BillingPort です。Takos Workspace ごとの usage は
明示された外部 account-plane binding を通して集計し、Takos の local owner proof と混同しません。詳しくは
[課金](/platform/billing) と [Takosumi operator model](https://takosumi.com/docs/reference/operator) を参照してください。

## 関連ドキュメント

- [Takosumi operator model](https://takosumi.com/docs/reference/operator) — 外部 account-plane boundary
- [Capsule Run Ledger](https://takosumi.com/docs/reference/model) — Workspace に追加する Capsule の管理台帳
- [Takosumi Capsule Lifecycle](https://takosumi.com/docs/reference/model) — Capsule の plan / apply lifecycle
