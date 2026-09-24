# OIDC Consumer

install したアプリは、operator の account plane がそのアプリ用に OIDC client を
発行していれば、Takosumi の issuer を利用できます。これは install 済みサービスへの
identity の発行であって、一般の第三者ログイン基盤ではありません。

## 流れ

1. アプリの Capsule を Git から install し、Takosumi の plan を確認して apply します。
2. operator の policy が許す場合、account plane がその Capsule / アプリ向けの
   OIDC client の発行を記録します。
3. Takos は発行済みのサインイン情報とともにアプリを Workspace に表示します。
4. 失効と rotation は account plane が扱い、監査記録として残ります。
5. 一般の第三者 consent / client registry の動作は、その product 面が明示的に
   作られるまでは対象外です。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

`plan` Run が確認用の plan を記録し、`apply` Run が承認済みの plan を参照して
StateVersion と Output を記録します。Takos と Takosumi の分担は
[Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)

## 公開 hosted での提供状況

公開 hosted install 向けの OIDC client は、operator の承認後に account plane が
開きます。公開 hosted アクセスが開くまでは、同じ OIDC の流れを operator の
rehearsal または self-host 環境で確認できます。新規の公開サインアップは閉じたままです。
