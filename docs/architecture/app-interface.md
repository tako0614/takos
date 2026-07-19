# Takos アプリの Interface

> Takos のアプリは普通の OpenTofu Capsule です。OpenTofu は deploy の事実を返すだけで、Takosumi がその上に
> runtime `Interface` を宣言し、`InterfaceBinding` で利用者を認可します。Takos は対応している Interface だけを
> 自分の UI に反映します。

## 所有権

Takosumi は Git で公開された module を Source / Capsule / Run / StateVersion / Output として記録します。apply
が成功すると、通常の root Output が記録されます。これらの Output はアプリの manifest でも runtime の登録簿でも
認証情報の経路でもありません。

runtime のメタデータは、Workspace、Capsule、または Resource が持つ Takosumi の service-side Interface です。
その宣言には次が含まれます。

- 利用側が決める `type` と `version`
- 任意の non-secret な JSON `document`
- `literal`、`capsule_output`、`resource_output` のいずれかから来る明示的な公開 input
- 公開範囲 (visibility) と、任意の policy / resource URI 参照

Takos は、自分が使い方を知っている解決済みの Interface の type と version だけを読みます。これにより、
Takosumi の宣言モデルを開いたまま保ちながら、Takos が未知のプロトコルや Output の形を推測しなくて済みます。

## 現在の managed Interface profile

managed MCP の経路は Streamable HTTP です。

1. アプリの Capsule が `mcp_url` のような通常の公開 endpoint Output を返します。
2. service-side の設定が、`type: mcp.server`、`version: 2025-11-25`、その Output への明示的な
   `inputs.endpoint` mapping を持つ Capsule 所有の Interface を作ります。
3. Takosumi が Interface を解決し、Output の provenance (来歴) と解決済みの revision を記録します。
4. InterfaceBinding が、その exact な revision について Principal に `mcp.invoke` を許可します。
5. Takos は解決済みで認可された Interface だけを一覧表示し、その tool を Workspace に公開します。

```text
普通の OpenTofu module
  -> 通常の Output: mcp_url
  -> Takosumi の Interface input mapping
  -> 解決済みの Interface revision
  -> Ready な InterfaceBinding (mcp.invoke)
  -> Takos の MCP registry と tool policy
```

Takos が現在受け付ける managed MCP Interface は、認証不要 (`delivery.type = none`) と Principal `oauth2` の
2 つです。OAuth では、Takosumi が Capsule が HTTPS resource の hostname を所有していることを証明したあと、
最大 60 秒の audience 限定 token を新しく発行します。Accounts の delegated token が Capsule へ送られることは
ありません。対応していない credential 配信を宣言する文書は、黙って公開サーバー扱いにはならず、拒否されます。
外部の MCP Connections は、Takos 内で別の OAuth と認証情報のフローを持ち続けます。

Takos は、認証不要の Principal profile もさらに 2 つ実装しています。

- `interface.ui.surface` version `1`: `inputs.url` を宣言し、`document.launcher = true` を要求し、`ui.open`
  を許可し、ランチャー / サイドバー用の表示メタデータを提供します。
- `interface.file.handler` version `1`: `inputs.openUrl` を宣言し、`file.open` を許可し、少なくとも 1 つの
  MIME type または拡張子でファイルを選びます。

どちらも `delivery.type = none` と、現在の解決済み revision に対する Ready な Binding を必要とします。
ファイルハンドラーの URL にはリテラルの `:id` パスセグメントが含まれます。これらの経路は Takosumi を直接
読み、Takos 側に publish/consume のキャッシュや Output Sync のフォールバックはありません。

Takos の Git install レビューでは、endpoint の Output、delivery の種類、ランチャーの Output、そして module
が必要とする場合は現在の Accounts issuer を受け取る通常の OpenTofu 変数を提案できます。すべての名前は明示的
です。Takos 自体には `takosumi_capsule_plan` や `takosumi_run_apply` という固定 tool はありません。operator が
Takosumi control operation を agent に公開する場合も、通常の control MCP Capsule / host adapter を deploy し、
その endpoint を `mcp.server` Interface として宣言し、利用者を InterfaceBinding で認可します。Takos はその
endpoint の live `tools/list` を request-local toolbox に取り込みます。tool 名や schema は MCP server の contract
であり、Takos の static registry ではありません。

## Takosumi control MCP の具体的な配信モデル

control MCP は特権 token を workload env に注入する仕組みではありません。operator-owned adapter は普通の Capsule
または Takosumi host extension として公開し、`endpoint` という ordinary non-secret Output だけを返します。service-side
InstallConfig は次のような通常の Interface blueprint と binding proposal を持ちます。

```json
{
  "interfaceBlueprints": [
    {
      "key": "operator-control-mcp-v1",
      "name": "operator-control-mcp",
      "spec": {
        "type": "mcp.server",
        "version": "2025-11-25",
        "document": {
          "transport": "streamable-http",
          "display": { "title": "Takosumi Control" }
        },
        "inputs": {
          "endpoint": {
            "source": "capsule_output",
            "outputName": "endpoint"
          }
        },
        "access": {
          "visibility": "workspace",
          "resourceUriInput": "endpoint"
        }
      },
      "bindings": [
        {
          "key": "installer-control",
          "subject": { "source": "installing_principal" },
          "permissions": ["mcp.invoke"],
          "delivery": { "type": "oauth2" }
        }
      ]
    }
  ]
}
```

最初の成功した apply 後、Takosumi は blueprint を普通の Interface と Ready な Principal InterfaceBinding に
materialize します。Interface の宣言・binding proposal・認可 authority は service-side にあり、Capsule module に
Takosumi control credential や Interface write authority を与えません。Takos からは materialize 済みの Interface /
InterfaceBinding API だけが見えます。

adapter は invocation 用 Interface OAuth token を自分の endpoint で検証し、その Principal / Workspace と現在の
Binding revision を使って Takosumi の public control service へ操作を委譲します。各 operation は Takosumi 側で
通常の RBAC、policy、saved-plan guard、Run / StateVersion / Output / audit を再評価します。adapter が broad な
operator token を Capsule に渡したり、OpenTofu Output に bearer credential を保存したりしてはいけません。
`serviceBindings: control.api` と `TAKOSUMI_CONTROL_TOKEN` env injection は廃止済みです。

## アプリメタデータ

install や表示用のメタデータは、必ずしも module から来る必要はありません。Git URL、ref、module path、アプリ名、
アイコン、カテゴリ、`InstallConfig.interfaceBlueprints` による Interface の宣言、Output の input mapping、
`InstallConfig.outputAllowlist` による公開 Output の選択は、Takosumi の service-side install 設定で管理できます。
ソースのリポジトリは普通の OpenTofu module のままであり、Takosumi 専用 provider resource は要求しません。
Form-backed Resource の portable な宣言は、verified な Takoform Form Definition の `interfaces[]` descriptor に置けます。
Takosumi はその descriptor から host-owned Interface を materialize しますが、InterfaceBinding は別の明示的な
service-side 認可です。

対応している Interface をアプリランチャー、Connections、file handling、agent tool にどう反映するかは Takos
が決めます。プロトコルを宣言しただけでは自動的に Takos の機能にはなりません。製品側がその Interface の
type / version とその permission の意味を明示的に実装する必要があります。

## 更新と依存関係

対応付けられた公開 Output が変わると、Takosumi は新しい Interface revision を解決します。Takos は利用側の
Capsule を再 apply しなくても、その revision を観測できます。この変更は Workspace 全体の reconcile を
起動しません。

ある OpenTofu module が plan / apply 中に別の module の値を必要とする場合は、明示的な Capsule Dependency か
通常の `terraform_remote_state` として表現します。これは runtime の Interface discovery / 認可とは別の話です。

## セキュリティ上の不変条件

- token、パスワード、署名鍵、秘密鍵、provider の認証情報は、Interface の document や解決済み input には
  現れません。
- sensitive とマークされた Output は Interface の input にはなれません。
- endpoint が存在することは、それを呼び出す権限を意味しません。InterfaceBinding が runtime の認可記録です。
- ProviderConnection / CredentialRecipe / ProviderBinding は OpenTofu Run の認証情報のためのものであり、
  runtime の利用者のためのものではありません。
- 未対応の Interface version、delivery 方式、mapping の欠落、古い binding、あいまいな identity は安全側に
  停止します。

## 関連ページ

- [Capsule の runtime Interface](./capsule-runtime-projection)
- [OpenTofu Output と runtime Interface](/deploy/runtime-interfaces)
- [MCP サーバー](/apps/mcp)
- [Takosumi Deploy-Control API](https://takosumi.com/docs/reference/deploy-control-api)
