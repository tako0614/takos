# 参照

`reference/` は、current CLI / API surface を使うときの参照章です。
`specs/` が「何に依存してよいか」を決める章だとすると、`reference/` は「その surface をどう読むか」を揃える章です。

## このページで依存してよい範囲

- CLI / API / glossary の読み分け
- どの surface をどのページで確認するか

## このページで依存してはいけない範囲

- architecture にしかない internal route や内部型を、reference の代わりに使うこと
- reference の断片だけで contract を決めること

## どのページを使うか

| 確認したいこと | 読むページ |
| --- | --- |
| API family ごとの責務と認証 | [API リファレンス](/reference/api) |
| CLI の top-level command と task domain | [CLI コマンドリファレンス](/reference/cli) |
| 用語の意味と public/internal の違い | [用語集](/reference/glossary) |

## implementation note

`reference/` は current surface の見取り図を示す章です。
実装差分が大きい面は、該当ページの implementation note で明示します。
特に deploy まわりは [Deploy System](/deploy/) と合わせて読んでください。

## 次に読むページ

- [API リファレンス](/reference/api)
- [CLI コマンドリファレンス](/reference/cli)
- [用語集](/reference/glossary)
