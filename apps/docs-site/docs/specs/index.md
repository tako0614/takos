# 独自仕様の全体像

Takos の `specs/` は、「利用者が何に依存してよいか」を決める章です。
実装コードに lower-level route や内部モデルが存在していても、この章で current contract として明示しない限り正本にはしません。

## このページで依存してよい範囲

- Takos の public contract をどこから読むべきか
- `specs/` の各ページが何を保証するか
- manifest / deploy / auth / OAuth の関係

## このページで依存してはいけない範囲

- architecture に出てくる内部都合を、ここを読まずに採用判断へ持ち込むこと
- repo に残る旧 deploy model や multi-document 形式を現行仕様とみなすこと
- CLI / API の lower-level fallback を主説明面だと解釈すること

## Takos の current contract を構成する柱

Takos の利用者がまず理解すべき contract は次の 4 本です。

1. `.takos/app.yml` で app をどう宣言するか
2. deploy が repo/ref と workflow artifact をどう扱うか
3. CLI がどの task model で API を露出するか
4. auth / OAuth がどの actor を前提にしているか

## どのページを読むか

| 目的 | 読むページ |
| --- | --- |
| docs 全体の trust boundary を知る | [仕様の読み方](/specs/reading-the-spec) |
| manifest を書く | [`.takos/app.yml`](/specs/app-manifest) |
| deploy の contract を知る | [Deploy System](/specs/deploy-system) |
| CLI と認証モデルを知る | [CLI / Auth model](/specs/cli-and-auth) |
| OAuth client / consent / token を知る | [OAuth](/specs/oauth) |
| Store / federation を知る | [ActivityPub Store](/specs/activitypub-store) |

## implementation note

`specs/` のページは、current contract を主説明面にします。
実装差分がある場合だけ implementation note を入れ、そこでは次を必ず分けて書きます。

- contract として採用してよい面
- 今日の wiring が届いている範囲
- 利用者が気にすべき影響

Deploy まわりはこの差分が大きいため、[Deploy System](/specs/deploy-system) を採用判断の前に確認してください。

## この章で主説明面にしないもの

- lower-level の worker / service deployment route
- multi-document package bundle spec
- `build` / `publish` / `promote` を中心にした旧 deploy model
- provider 固有の内部データ構造

## 次に読むページ

- [仕様の読み方](/specs/reading-the-spec)
- [`.takos/app.yml`](/specs/app-manifest)
- [Deploy System](/specs/deploy-system)
- [CLI / Auth model](/specs/cli-and-auth)
