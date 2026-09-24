# Takos の概念

Takos は、AI エージェントへの依頼とその成果物を一か所にまとめるワークスペースです。
chat、agent、memory、Workspace、アプリの追加は Takos が受け持ち、アプリの install や
インフラの実行履歴は Takosumi が Source / Capsule / Run / StateVersion / Output として記録します。

## 現在の流れ

1. `deploy/opentofu` 配下の adapter と worker artifact で、Takos の配布構成をデプロイします。
2. 立ち上がった worker が Takos の product route を公開し、外部の Takosumi Accounts /
   deploy-control / dashboard / OpenTofu runner を利用します。
3. Takos Workspace を作り、利用者が Capsule アプリを plan / apply の Run で明示的に追加します。
4. インフラの credential、OIDC client、課金、ドメイン、アカウントの policy は
   Takosumi Accounts plane が持ちます。

## Takos と Takosumi の境界

Takos が持つのは利用者向けのワークスペース体験です (chat、agent、memory、Workspace、
アプリの起動)。Git、ストレージ、agent runtime、file handler、UI、MCP は Capsule の
Output と Takos の runtime contract 経由で公開されます。

Takosumi は Workspace / Project / Capsule / Source / ProviderConnection / ProviderBinding /
Run / StateVersion / Output の権限を持ち、Takosumi Accounts plane がアカウントの
policy、課金、OIDC を管理します。この分担の詳細は
[内部トラスト境界](/architecture/internal-trust-boundaries)を参照してください。

## API の形

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

この形で作られた Capsule は typed Run として記録されます。Takos の product route は
Takosumi の deploy control plane または account-plane の install flow を呼び、独自の
deploy 権限は持ちません。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
