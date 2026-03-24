# Resource / Binding

## Resource

Resource は service が利用する backing capability です。Takos では少なくとも次の resource type が登場します。

- d1
- r2
- kv
- secretRef
- vectorize
- assets

利用者が最初に強く意識するのは、`.takos/app.yml` に現れる `d1 / r2 / kv / secretRef / vectorize` です。

## Binding

Binding は service から resource や他 service を参照するための名前付き接続です。Binding には次の役割があります。

- service へ database / object store を渡す
- service へ vector index を渡す
- worker service から他 service を呼ぶ
- 実行時の resource 名と app manifest の logical 名を結び付ける

## なぜ Resource と Binding を分けるのか

Resource は「何を使うか」、Binding は「どういう名前で service に渡すか」です。  
この分離により、resource の実体が provider によって違っても、service 側の contract は比較的安定させられます。

## deploy 時の snapshot

Takos の deployment では、runtime config, bindings, env vars の snapshot が deployment ごとに固定されます。  
これにより、rollback や local runtime materialization のときも、同じ execution contract を再現しやすくなります。

## current tenant binding contract

tenant worker の public binding contract は、現時点では次に絞っています。

- D1
- R2
- KV
- Vectorize
- service binding
- plain text / secret text

Cloudflare Workers に存在するすべての binding をそのまま公開しているわけではありません。  
Durable Objects や Queues などは、Takos の tenant contract にはまだ含めていません。
