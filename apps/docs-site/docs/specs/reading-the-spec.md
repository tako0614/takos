# 仕様の読み方

Takos Docs は、利用者が依存してよい面と、実装を理解するためだけの面を分けて読むための site です。
このページは、その境界を決める正本です。

## このページで依存してよい範囲

- `specs/` と `reference/` をどう読むか
- `current contract` / `implementation note` / `internal model` の意味
- 「何を採用判断の根拠にしてよいか」のルール

## このページで依存してはいけない範囲

- repo に残っている旧 naming や旧 route を、docs の説明なしに current とみなすこと
- architecture 上の内部用語を、そのまま public contract だと解釈すること
- implementation note を「今はたまたま動く」一覧として読むこと

## ラベル体系

| label | meaning | rely on it |
| --- | --- | --- |
| current contract | 利用者が新規採用してよい documented public surface | yes |
| implementation note | current contract と今日の実装接続の差分 | yes, ただし差分として読む |
| public surface | CLI / API / manifest のように利用者が直接触る面 | yes |
| internal model | control plane / provider / runtime の内部構造 | no |
| reserved | 将来候補。名前が出ても未サポート | no |
| historical model | 旧 docs や legacy naming / command | no |

## 章ごとの役割

| chapter | 役割 | 採用判断に使うか |
| --- | --- | --- |
| `overview/` | Takos 全体像と読み順 | yes, ただし入口として |
| `concepts/` | public 用語と internal 用語の対応を理解する | yes, ただし概念理解として |
| `specs/` | public contract を読む主説明面 | yes |
| `reference/` | current CLI / API surface を使うときの参照面 | yes |
| `architecture/` | internal model と構成の説明 | no |
| `operations/` | provider 差分や運用条件の確認 | yes, ただし運用面として |

## implementation note の扱い

implementation note は、Takos Docs で最も誤読されやすいラベルです。
このラベルは「今はこの lower-level route を使えばよい」という実装逃げ道の宣伝ではなく、次の 3 点を固定で示すために使います。

1. current contract は何か
2. 今日の実装がどこまでその contract に追いついているか
3. その差分が利用者にどんな影響を与えるか

implementation note があるページでは、current contract と current wiring を混ぜて書きません。
差分があるなら差分として分離し、差分がないなら note を膨らませません。

## 判断ルール

Takos Docs を読むときは、次の順で判断します。

1. `specs/` または `reference/` に書かれているか
2. その記述が `current contract` として扱われているか
3. implementation note が付いているなら、差分の影響を読んだか
4. architecture にしか出てこない名前を public surface と誤読していないか

### 契約外として扱うもの

- この site に出てこない field / endpoint / command
- `reserved` として出てくる名前
- `historical model` に分類される旧 surface
- internal model の lower-level route や table 名

### docs drift の扱い

- current contract と実装が食い違うのに implementation note が無い場合は、仕様ではなく docs drift か実装バグとして扱います。
- internal model を public contract に昇格させるときは、必ず `specs/` か `reference/` に明示します。
- repo にコードがあるだけでは contract になりません。

## 読み順

- Takos の全体像を掴むなら [Takos overview](/overview/)
- 用語の対応を整理するなら [中核概念](/concepts/)
- `.takos/app.yml` と deploy の contract を読むなら [独自仕様](/specs/)
- CLI / API の使い方を確認するなら [参照](/reference/)

## 次に読むページ

- [独自仕様の全体像](/specs/)
- [Takos overview](/overview/)
- [API リファレンス](/reference/api)
- [CLI command reference](/reference/commands)
