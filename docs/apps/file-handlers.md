# File Handlers

file handler は、install したアプリが Workspace 内の特定のファイル形式を開いたり
編集したりする仕組みです。Takos は Takos 専用の manifest ではなく、Capsule の
Output の projection を通して handler を検出します。

## 流れ

1. アプリの Capsule を Git から install します。
2. Takosumi の plan を確認して apply します。
3. アプリが `interface.file.handler` のような capability で、秘密でない
   service metadata を公開します。
4. Takos は束縛された export を読み、一致するファイルにその handler を表示します。
5. 実行時の権限が必要な場合は、OpenTofu の Output 値ではなく、deploy 済みの
   runtime / account-plane の境界から供給されます。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "source": "github.com/example/takos//deploy/opentofu/cloudflare",
    "ref": "main"
  }
}
```

adapter を選ぶと `plan` Run のあと `apply` Run が走り、StateVersion と
秘密でない endpoint が Output に記録されます。Takos の product route は Takosumi の
deploy-control の記録と Capsule Output の projection を使い、独自の deploy 権限は
持ちません。境界の全体像は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
