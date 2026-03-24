# Workspace / Space

Takos の最上位の隔離単位は `Space` です。利用者向け surface では `Workspace` という語が残る場面がありますが、概念としては同じ境界を指します。

## 何を隔離するか

Workspace / Space は、少なくとも次をまとめて管理します。

- member と role
- repo
- worker / service
- resource
- thread / run

## role

Takos の membership role は次です。

- owner
- admin
- editor
- viewer

権限の細部は surface ごとに異なりますが、まず「誰の workspace か」「誰が deploy や resource 操作をできるか」を決める単位として理解すれば十分です。

## public と internal の違い

利用者向け surface では `workspace` という名前が残ります。  
内部モデルや一部の型では `space` が canonical です。 docs では混乱を避けるため、`Workspace / Space` と併記します。
