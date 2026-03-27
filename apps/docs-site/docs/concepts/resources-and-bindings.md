# Resource / Binding

## Resource

Resource は service が利用する backing capability です。Takos では少なくとも次の resource type が登場します。

- d1
- r2
- kv
- secretRef
- vectorize
- queue
- analyticsEngine
- workflow
- durableObject
- assets

利用者が最初に強く意識するのは、`.takos/app.yml` に現れる `d1 / r2 / kv / secretRef / vectorize / queue / analyticsEngine / workflow / durableObject` です。

### いまの contract の見方

- `queue`: producer/consumer を持つメッセージング resource
- `analyticsEngine`: append-only の analytics dataset resource
- `workflow`: tenant worker の named export を起動する managed workflow contract
- `scheduled`: resource ではなく trigger contract

`workflow` は Cloudflare native Workflows binding を直接露出するのではなく、Takos-managed contract として扱います。

`durableObject` は tenant worker が export する Durable Object class への namespace binding です。D1 / R2 / KV と違い Cloudflare 上に別途リソースを作成する必要はなく、class 名を manifest で宣言するだけで binding が生成されます。

## Binding

Binding は service から resource や他 service を参照するための名前付き接続です。Binding には次の役割があります。

- service へ database / object store を渡す
- service へ vector index を渡す
- service へ queue / analytics dataset / workflow handle を渡す
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
- Queue
- Analytics Engine
- Workflow resource
- Durable Objects
- service binding
- plain text / secret text

Cloudflare Workers に存在するすべての binding をそのまま公開しているわけではありません。
Browser binding や Workers AI binding などは、Takos の tenant contract にはまだ含めていません。

`queue` / `analyticsEngine` / `workflow` は manifest と bundle docs では受け付けますが、runtime/provider の parity は feature ごとに異なります。  
local tenant runtime は `durableObject` と `queue` producer binding を materialize しますが、`vectorize` はまだ materialize しません。`workflow` は resource 管理と worker binding/invocation が分かれています。

## Trigger contract

tenant worker には binding だけでなく trigger contract もあります。

- `scheduled`: cron による named export 起動
- `queue consumer`: queue message による named export 起動

Takos では trigger の宣言は `.takos/app.yml` で行います。  
一方で delivery/orchestration は provider-native contract をそのまま露出せず、Takos の runtime model に寄せます。
