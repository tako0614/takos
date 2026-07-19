# Capsule の runtime Interface

> このページは、普通の OpenTofu Output と Takos が使う runtime サービスの境界を定義します。URL は既存の
> リンクのために残していますが、現在のモデルは Takosumi の `Interface` / `InterfaceBinding` であり、Output
> 駆動の runtime projection プロトコルではありません。

## 1. モデル

Takosumi には 2 つのデプロイ記述フローと、1 つの共有 runtime interaction 層があります。

```text
OpenTofu Stack flow         Resource Shape flow
        |                          |
        +---- 公開 Output ---------+
                       |
        Takosumi の Interface input 解決
                       |
        Interface + 解決済み revision / provenance
                       |
        InterfaceBinding + permission / delivery
                       |
        Takos または他のプロトコル利用者
```

OpenTofu Output は root module の戻り値のままです。Interface は service-side の runtime 宣言です。
InterfaceBinding は明示的な runtime 利用者の認可です。どれも他を置き換えるものではありません。

## 2. 所有権

| 関心事                                                | 所有者                                                  |
| ----------------------------------------------------- | ------------------------------------------------------- |
| インフラと root Output の形                           | OpenTofu module と provider                             |
| Source / Capsule / Run / StateVersion / Output の記録 | Takosumi Stack flow                                     |
| runtime の宣言と input mapping                        | Takosumi Interface 設定                                 |
| runtime 利用者の認可                                  | Takosumi InterfaceBinding                               |
| プロトコルの解釈と製品での見せ方                      | Takos または他の利用者                                  |
| plan / apply / destroy 用の provider 認証情報         | ProviderConnection / CredentialRecipe / ProviderBinding |

Takosumi は、HCL や Output 名がどうであっても、そこから runtime の意味を推測しません。Takos は Interface を利用するからと
いって、OpenTofu の state や provider の認証情報の所有者にはなりません。

## 3. Interface の宣言

Interface には owner (`Workspace`、`Capsule`、`Resource` のいずれか)、安定した名前、label、generation が
あります。その spec は意図的に小さく作られています。

| フィールド | 意味                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| `type`     | 利用者が解釈する、開かれたプロトコル/サービスの識別子                       |
| `version`  | その type の契約バージョン                                                  |
| `document` | その契約が持つ、任意の non-secret な JSON                                   |
| `inputs`   | 明示的な公開値への named mapping                                            |
| `access`   | `private` / `workspace` / `public` と、任意の policy / resource URI mapping |

Takosumi core は document を中身を解釈せずそのまま保存します。利用者は、自分が対応する exact な type、
version、document のサブセット、解決済みの input、permission を検証する必要があります。これが主な拡張ポイント
です。プロトコルを追加しても、新しい OpenTofu Output の慣習や Takosumi 専用のリポジトリファイルは必要
ありません。

### MCP の例

```json
{
  "workspaceId": "ws_1",
  "name": "researchTools",
  "ownerRef": { "kind": "Capsule", "id": "cap_1" },
  "spec": {
    "type": "mcp.server",
    "version": "2025-11-25",
    "document": {
      "transport": "streamable-http",
      "display": { "title": "Research tools" }
    },
    "inputs": {
      "endpoint": {
        "source": "capsule_output",
        "capsuleId": "cap_1",
        "outputName": "mcp_url"
      }
    },
    "access": {
      "visibility": "workspace",
      "resourceUriInput": "endpoint"
    }
  }
}
```

アプリの module が返す必要があるのは、deploy の事実だけです。

```hcl
output "mcp_url" {
  value = "${cloudflare_worker_deployment.app.url}/mcp"
}
```

Interface の宣言は service-side の設定に置かれます。`/v1/interfaces` から直接作ることも、apply 成功後に
`InstallConfig.interfaceBlueprints` から一度 materialize することもできます。blueprint はアプリのリポジトリから
読み込むものではありません。Form-backed Resource だけは、verified な Takoform Form Definition の `interfaces[]`
descriptor から portable な宣言を materialize できます。どちらでも record と認可は Takosumi が所有し、plain
Capsule に Takosumi 専用 provider resource は要求しません。`InstallConfig.outputAllowlist` は UI や install summary
に公開する通常の Output を選ぶ別の設定で、Interface の宣言や lifecycle action の発見には使いません。

## 4. Input の解決

Interface の input には、次の 3 種類のいずれかの由来があります。

- `literal`: service-side の設定にある non-secret な JSON
- `capsule_output`: Capsule id、通常の root Output 名、任意の RFC 6901 JSON Pointer
- `resource_output`: Resource id、公開されている観測済み output 名、任意の JSON Pointer

resolver は解決した公開値を `status.resolvedInputs` に書き込み、input ごとの provenance を記録します。
Capsule の provenance には Output の id、digest、名前、pointer、利用可能な Run / StateVersion の id が含まれ
ます。Resource の provenance には Resource の id と generation が含まれます。

参照元が存在しない、OpenTofu または明示的な mapping で sensitive とマークされている、pointer が無効、削除済み、
その他利用できない場合、解決は安全側に停止します。普通の module に sensitive な state や Output があっても
かまいません。それらは単に、この公開 runtime 層の対象外になるだけです。

## 5. ライフサイクル

Interface の状態は Capsule の apply 状態とは独立しています。

```text
Pending -> Resolved
Pending/Resolved -> NotReady または Unknown
delete -> Terminating -> Retired
```

`observedGeneration` は、どの宣言の generation が評価されたかを利用者に伝えます。`resolvedRevision` は実効的
な解決済み契約が変わると変化します。利用者は、その同じ revision を観測する binding を使う必要があります。

Output の変更は、その Output を明示的に mapping している Interface だけを再解決の対象にします。Workspace 内の
すべての Capsule を plan / apply することはなく、runtime 利用者側の OpenTofu module を stale にもしません。
Resource の変更も同じ明示参照のルールに従います。

## 6. InterfaceBinding

InterfaceBinding は 1 つの対象を認可します。

- `Principal`
- `ServiceAccount`
- `Capsule`
- `Resource`

Binding には permission と delivery の記述があります。delivery は `none`、`oauth2`、`workload_token` のような
開かれた capability token です。任意の `credentialRef` は参照であり、認証情報の値そのものではありません。
Binding が使えるのは、`Ready` であり、かつ Interface の現在の解決済み revision を観測しているときだけです。
失効すると Binding は `Revoked` になります。

core は既定で認証不要の delivery を有効にしています。host が issuer を提供し、Interface の owner が認証情報
なしの HTTPS resource の hostname を実際に所有していることを証明できる場合は、Principal `oauth2` の delivery
にも対応します。literal や Output の URL だけでは所有の証明になりません。workload-token と Secret を使う
delivery は、host が明示的な実装を提供するまで `NotReady` のままです。

## 7. Takos の利用者 profile

Takos は 3 つの厳密な managed Interface profile を実装しています。それぞれの読み取りには、exact な
Takosumi Interface の envelope、宣言の generation と一致する observed generation を持つ Resolved 状態、正の
解決済み revision、そして現在の Principal に対してその revision を観測する Ready な binding が必要です。

| 対象                         | type / version                 | 必須の宣言と解決済み input                                                                                                                                               | permission / delivery                                    |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| MCP tool                     | `mcp.server` / `2025-11-25`    | 宣言された `inputs.endpoint`; `status.resolvedInputs.endpoint`; `document.transport = streamable-http`                                                                   | `mcp.invoke`; `none` または実装済みの Principal `oauth2` |
| アプリランチャーとサイドバー | `interface.ui.surface` / `1`   | 宣言された `inputs.url`; `status.resolvedInputs.url`; `document.launcher = true`; 任意の `document.display` / `document.sidebar`                                         | `ui.open`; `none`                                        |
| ファイルを開くハンドラー     | `interface.file.handler` / `1` | 宣言された `inputs.openUrl`; `status.resolvedInputs.openUrl`; 少なくとも 1 つの有効な `document.mimeTypes` または `document.extensions`; 任意の `document.display.title` | `file.open`; `none`                                      |

`document.display` の正規キーは `title` / `description` / `icon` / `category` /
`sortOrder`(すべて任意)で、正本は Takosumi spec の Display Metadata Contract です。
`display.icon` は「credential 情報を含まない絶対 HTTPS URL」「surface の解決済み
runtime URL の origin 基準で解決する先頭 `/` パス(例: `/icons/app.svg`)」
「16 文字以内で `/` `.` `:` を含まない emoji glyph」の 3 形式のみを受け付けます。

runtime の URL は HTTP(S) で、userinfo や fragment を含まず、認証情報らしき query parameter も含みません。
ファイルハンドラーの URL はさらに、リテラルの `:id` パスセグメントを 1 つ含む必要があります。Takos はその
セグメントを選択したファイル ID に置き換えます。UI とファイルハンドラーの document は、自分専用の認証や
credential 配信の仕組みを要求できません。

ランチャーの route、サイドバーの拡張、ファイルハンドラーの route はすべて、これらの認可された Interface を
直接読みます。Takos 側の publication cache、consume resolver、Output Sync のフォールバックはありません。
未知の version、認証フィールド、未対応の delivery、不正な URL、宣言されていない input、古い binding は安全側
に停止して除外されます。

外部の MCP Connections は引き続き別の Takos 機能です。その直接 URL、registry discovery、OAuth token、
ユーザーレビュー、tool policy は、OpenTofu Output に偽装されることなく Takos が保存・管理します。

## 8. 依存関係の境界

次の 2 つの関係は区別します。

```text
Capsule Dependency / terraform_remote_state
  = 別の OpenTofu の plan や apply が必要とする値

InterfaceBinding
  = デプロイされた runtime を使う権限
```

Interface を変えても、インフラの依存関係を意味しません。Capsule Dependency を変えても、runtime へのアクセス
権限を与えません。

## 9. セキュリティ上の不変条件

- Interface の document、literal、解決済み input は non-secret です。
- OpenTofu または明示的な mapping で sensitive とマークされた Output は Interface の input になれません。
  名前自体はそれ以外は opaque です。
- token、パスワード、署名鍵、provider の認証情報は、Interface、Binding、解決済み input、ログ、audit の
  payload には入りません。
- ProviderConnection は OpenTofu Run の認証であり、runtime Interface の認可ではありません。
- discovery は呼び出し権限を意味しません。
- 未対応のプロトコル version と credential delivery は安全側に停止します。

## 10. 移行の経緯

pre-v1 の実装は `service_exports`、`service_bindings`、`app_deployment` を runtime の宣言として解釈し、
Workspace 全体の Output Sync の挙動も持っていました。そのプロトコルは廃止済みです。module がこれらの名前を
返しても、現在は特別な runtime の意味を持たない普通の opaque な Output として扱われます。

移行では、明示的な service-side Interface を作り、必要な公開 Output 名だけを mapping し、InterfaceBinding を
作り、以前公開されていた認証情報を rotate してから、古い宣言用の Output を削除します。廃止されたプロトコル
への runtime のフォールバックはありません。

## 11. 実装への参照

- 共有契約: `takosumi/contract/interfaces.ts`
- Resolver とライフサイクル: `takosumi/core/domains/interfaces/`
- HTTP API: `takosumi/core/api/interface_routes.ts`
- Takos の Interface 利用側: `takos/src/worker/application/services/platform/takosumi-interfaces.ts`
- MCP の表示アダプター: `takos/src/worker/application/services/platform/mcp/interface-read.ts`
- ランチャー route: `takos/src/worker/server/routes/apps/routes.ts`
- ファイルハンドラー route: `takos/src/worker/server/routes/spaces/storage-management.ts`
