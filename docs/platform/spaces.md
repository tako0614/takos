# Workspace

> このページでわかること: Takos Workspace が一人の利用者の用途別カテゴリーであることと、旧 `Space` / team 語彙との違い。

Takos の **Workspace** は、一人の Principal が chat、agent、memory、Git
repository、apps、MCP tools を用途別にまとめる private な作業領域です。仕事、趣味、
案件、生活などを分けるため複数作れます。共同作業用の team や organization では
ありません。

```txt
Takos Principal
  ├─ Workspace: 仕事
  ├─ Workspace: 個人開発
  └─ Workspace: 旅行
        └─ chats / files / memory / apps / connections
```

一つの Takos host が複数 Principal を収容することはできます。その場合も各 Principal
の Workspace は互いに発見・参照できず、member、invite、role、ownership transfer
を公開しません。

## Identity と isolation

外部 OIDC の `(issuer, sub)` を一つの app-local Principal へ写します。認証と
Workspace の分類は別の責務です。新しい Workspace を作っても新しい account、
Takosumi Workspace、OIDC subject は作りません。

Takosumi integration を構成した場合、外部 identity と委任された Capsule / Interface
lifecycle は Takosumi を正本 (正とする情報)にします。ただし Takosumi Accounts の user/team modelを
Takos Workspaceへ投影しません。Takosumi Resource Shape API の `Space` も shape
namespace / policy scope であり、Takos Workspace とは別物です。

## Legacy storage compatibility

旧 docs / DB / route 名に残る `space` は Takos product-local な互換語彙です。現行 DB
では自動生成した既定 Workspace を `accounts.type = user`、追加 Workspace を
`accounts.type = team`、Principal との対応を `account_memberships.role = owner` として
保存します。これらは schema/data migration までの内部表現であり、team や role を
public modelに戻す根拠ではありません。

互換 owner row だけでは権限にならず、Workspace row の `owner_account_id` と active な
owner row の両方が Principal と一致するときだけアクセスできます。legacy な
non-owner、suspended、owner を偽装した membership row はアクセス権にならず、Workspace
一覧にも出しません。
DB語彙を変える作業はdurable data migrationとして別に設計します。

既定 Workspace は `GET /api/me/personal-space` で取得でき、`/api/spaces/me` で参照
できます。追加 Workspace も同じく private で、違いは自動生成か利用者作成かだけです。

## Git state

Workspace の作成は Workspace row と Principal の互換 owner row だけを作り、空の
default repository は自動作成しません。Git は明示的に作成・install された capability
（通常は `takos-git` の Interface）として接続します。

旧 version で作成済みの repository row はこの変更では削除しません。互換 read や
利用者による明示的な移行を壊さず、Workspace lifecycle と repository lifecycle を
分離します。

## 課金との関係

請求主体は operator account plane（リファレンス実装: Takosumi Accounts）/
BillingPort です。Takos Workspace は請求 account や team ではなく、利用量を分類・
隔離する product-local container です。詳しくは [課金](/platform/billing) と
[Takosumi operator model](https://takosumi.com/docs/reference/operator) を参照してください。
