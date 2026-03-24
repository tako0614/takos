# 用語集

## Workspace / Space

所有・隔離の最上位単位。public surface では workspace、internal では space が canonical。

## Repo

source と workflow artifact の起点。

## Worker

public surface での deployable unit。

## Service

internal model での実行単位。current public manifest では worker service が正本。

## Route

service への入り口。

## Resource

service が利用する backing capability。D1, R2, KV など。

## Binding

service へ resource や他 service を渡す名前付き接続。

## Thread

継続する対話や作業コンテキスト。

## Run

thread 上の 1 回の実行。

## Artifact

run の結果物。

## Provider

deploy backend の種類。cloudflare や oci など。

## Tenant runtime

deploy された artifact が実際にリクエストを処理する面。
