# Worker + DB

データベースを持つ module の例です。module は DB の接続先を示す非 secret な識別子または
endpoint だけを通常の Output として返し、apply の成功後に Takosumi の Output から確認できます。
credential は Output に含めず、ProviderConnection が管理します。

## 流れ

1. OpenTofu module を持つ Git リポジトリの URL と ref を選びます。
2. Capsule を作り plan を実行し、`plan` Run の差分と警告を確認します。
3. 確認した plan を apply します。`apply` Run として記録され、成功すると
   StateVersion と Output が更新されます。DB の非 secret な識別子または endpoint だけがこの Output に出ます。
4. 消すときは `destroy_plan` の確認を経て `destroy_apply` まで進みます。

接続 (credential) は ProviderConnection が参照を持ち、ProviderBinding が module の
provider ごとに接続を解決します。sensitive な値は public Interface input へ公開できません。OIDC client、課金、ドメインは
Takosumi Accounts plane の管轄です。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

plan の要求は `plan` Run を作り、apply の要求はその `plan` Run を参照します。
確認した plan だけが適用されます。Takos と Takosumi の分担は
[Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
