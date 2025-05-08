# ActivityPub グループ DM 配送仕様

## 1. 目的と範囲

本仕様は、ActivityPub上で動作する分散ソーシャル・ネットワークにおいて、**プライベートな複数人トークルーム (グループ DM)** を実装するための配送プロトコルを定義する。

## 2. 用語と表記

* **MUST／SHOULD／MAY** は \[RFC 2119] に従う。
* **Group Actor** — `type:"Group"` の ActivityPub Actor。ルーム本体。
* **User Actor** — `type:"Person"` 等の個人 Actor。
* **Follower** — Group Actor の `followers` Collection に含まれる User Actor (= 正式メンバー)。
* **Invitation Recipient** — 招待を受領したが未応答の User Actor。

## 3. メンバーシップ・モード

グループ DM は以下の 3 モードのいずれかを **Group Actor のメタデータ (`joinMode`)** で示さなければならない。

| モード         | `joinMode` 値 | 参加方法                                                         | 承認 Activity                         | 備考                                                  |
| ----------- | ------------ | ------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------- |
| **参加申請モード** | `"request"`  | ユーザが `Follow` を送信し、Group が `Accept`/`Reject` で応答             | `Accept{Follow}` / `Reject{Follow}` | 一般的な承認制ルーム                                          |
| **招待モード**   | `"invite"`   | Group (または Moderator) が `Invite` を送信し、ユーザが `Accept`/`Reject` | `Accept{Invite}` / `Reject{Invite}` | 非公開コミュニティ向け。`Invite` は独自 Activity または `Offer` 拡張で実装 |
| **自由参加モード** | `"open"`     | ユーザが `Follow` を送れば即時メンバー                                     | —                                   | `Follow` 到着をトリガに自動 `Add` して followers に登録           |

*Group Actor 例:*

```jsonc
{
  "@context": ["https://www.w3.org/ns/activitystreams"],
  "type": "Group",
  "id": "https://example.com/groups/devroom",
  "name": "Dev Room",
  "joinMode": "request",
  "inbox": "…/inbox",
  "outbox": "…/outbox",
  "followers": "…/followers"
}
```

## 4. 主要エンドポイント

| エンドポイント     | 必須 | 説明                                  |
| ----------- | -- | ----------------------------------- |
| `inbox`     | ✅  | 参加申請・招待応答・メッセージ投稿を受付                |
| `outbox`    | ✅  | Group が生成した Activity 履歴 (読み取りは GET) |
| `followers` | ✅  | 正式メンバーのリスト (サーバ内部で更新)               |
| `blocked`   | 🚫 | 任意。強制退会後の再参加を阻止する場合に利用              |

## 5. メンバーシップ・ライフサイクル

### 5.1 共通 Activity 一覧

| Scenario | Activity                | Actor             | Object | Target      | Join Mode    |
| -------- | ----------------------- | ----------------- | ------ | ----------- | ------------ |
| 参加申請     | `Follow`                | User              | Group  | —           | request/open |
| 申請承認     | `Accept{Follow}`        | Group             | Follow | —           | request      |
| 申請拒否     | `Reject{Follow}`        | Group             | Follow | —           | request      |
| 招待送信     | `Invite`                | Group / Moderator | User   | Group       | invite       |
| 招待承認     | `Accept{Invite}`        | User              | Invite | —           | invite       |
| 招待拒否     | `Reject{Invite}`        | User              | Invite | —           | invite       |
| 自動参加     | `Add` (server‑internal) | Group             | User   | `followers` | open         |
| 退出       | `Undo{Follow}`          | User              | Follow | —           | all          |
| 強制退会     | `Remove`                | Group / Moderator | User   | `followers` | all          |

> **`Invite` Activity**: Vocabulary に標準定義が無いため、`type:"Invite"` のカスタム Activity **または** `Offer` Activity (`type:"Offer"`, `object:Group`) の拡張で表現して良い。

### 5.2 状態遷移図

```
┌─────────┐   Follow/Invite   ┌────────────┐  Accept  ┌─────────┐
│Non‑Member│ ───────────────▶│  Pending   │───────▶│  Member │
└─────────┘                   └────────────┘ Reject  └─────────┘
      ▲      Remove/Kick ▲          │ Undo │             │ Undo/Leave
      └──────────────────┘◀─────────┘◀────────────┘
```

## 6. メッセージ投稿・配送

```
Member  ─Create{ChatMessage}→  Group.inbox
  (1) validate (must be Follower)
  (2) store to outbox (OrderedCollection)
  (3) fan‑out by domain
      ├─> inbox@domain‑A  (bto/bcc 合括)
      └─> inbox@domain‑B  …
```

1. **投稿**: メンバーは `Create{ChatMessage}` を Group `inbox` に送信し、`to:[Group]` とする。
2. **検証**: サーバは `actor` が `followers` に含まれることを MUST 確認。
3. **保存**: メッセージを Group `outbox` (`OrderedCollection`) に追加。
4. **ファンアウト**: `followers` をドメイン単位でグループ化し、各リモート inbox へ一括 POST。ローカルユーザにはキューを共有して即時配信。

*Pull 履歴*: クライアントは `outbox?page=true` でページング取得 MAY。

## 7. 編集・削除

| 機能       | Activity              | 権限                        | 必須     |
| -------- | --------------------- | ------------------------- | ------ |
| **自己編集** | `Update{ChatMessage}` | 投稿者本人                     | MAY    |
| **削除**   | `Delete{ChatMessage}` | 投稿者本人 / Moderator / Owner | SHOULD |

## 8. 権限ロール

```
Owner > Moderator > Member
```

* Moderator は `Invite` / `Remove` の代行を許可。

## 9. セキュリティ考慮事項

* Group サーバは **Follower 以外** からの `Create{ChatMessage}` 及び `Invite` を MUST 拒否。
* 強制退会後の再参加を防ぐ場合、`blocked` Collection **SHOULD** を実装。
* ドメイン batching 送信時、`bto`/`bcc` を利用してもメンバー一覧がリモートインスタンス内でのみ復元可能である点を理解すべし。
* ChatMessageの正当性は担保していません。signatureを検証してから保存してください。
