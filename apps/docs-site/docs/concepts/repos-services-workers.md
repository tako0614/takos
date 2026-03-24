# Repo / Service / Worker

## Repo

Repo は deploy の入力になる source と workflow artifact の起点です。  
Takos は repo-local な `.takos/app.yml` と workflow artifact を使って app deploy を解決します。

## Service

Service は internal model での実行単位です。service には少なくとも次の形があります。

- worker service
- http-url target

App は複数 service を持てます。現在の `.takos/app.yml` v1alpha1 では worker service を正本にしつつ、internal routing model では外部 HTTP backend への target も扱います。

## Worker

Worker は public surface での deployable unit です。利用者からは `workers` が見えますが、内部では service / route / deployment のモデルに分解されています。

## route

route は service への入り口です。Takos では route を通じて、主に worker service に path を割り当てます。

## なぜ Worker と Service を分けるのか

- public では `workers` がわかりやすい
- internal では service graph のほうが routing / rollback / provider 差分を扱いやすい

このため Takos は、利用者向けには worker を保ちつつ、内部では service-centric に寄せています。
