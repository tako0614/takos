# 中核概念

`concepts/` は、Takos の public 用語と internal 用語の対応を揃える章です。
仕様そのものを決めるのは `specs/` ですが、仕様を誤読しないための前提はここで整理します。

## このページで依存してよい範囲

- Takos の概念マップ
- public surface と internal model の言葉のズレ
- 各概念をどの章で詳しく読むべきか

## このページで依存してはいけない範囲

- concepts の記述だけで API / CLI / manifest の詳細契約を決めること
- architecture 用語を public surface と同一視すること

## 概念マップ

- Workspace / Space: 境界と所有
- Repo / Service / Worker: source と deploy の単位
- Resource / Binding: 状態や外部接続
- Thread / Run / Artifact: AI 実行の単位
- Package / Ecosystem: 配布と統合

## どの概念がどこに出てくるか

| 概念 | 主に読む章 |
| --- | --- |
| Workspace / Space | [Workspace / Space](/concepts/spaces-and-workspaces), [API リファレンス](/reference/api) |
| Repo / Service / Worker | [Repo / Service / Worker](/concepts/repos-services-workers), [`.takos/app.yml`](/specs/app-manifest) |
| Resource / Binding | [Resource / Binding](/concepts/resources-and-bindings), [Deploy System](/specs/deploy-system) |
| Thread / Run / Artifact | [Thread / Run / Artifact](/concepts/threads-and-runs), [API リファレンス](/reference/api) |
| Package / Ecosystem | [Package / Ecosystem](/concepts/packages-and-ecosystem), [ActivityPub Store](/specs/activitypub-store) |

## 用語のズレで迷いやすい点

- public surface では `workspace`、internal model では `space`
- public surface では `worker`、internal model では `service`
- public surface では `app deployment`、内部では lower-level deployment が併存する

これらのズレは、Takos が複数の provider と runtime をまたいでいるために生まれます。
採用判断は public 側の言葉に合わせて行い、内部構造の理解は architecture 側で補います。

## 次に読むページ

1. [Workspace / Space](/concepts/spaces-and-workspaces)
2. [Repo / Service / Worker](/concepts/repos-services-workers)
3. [Resource / Binding](/concepts/resources-and-bindings)
4. [Thread / Run / Artifact](/concepts/threads-and-runs)
5. [Package / Ecosystem](/concepts/packages-and-ecosystem)
