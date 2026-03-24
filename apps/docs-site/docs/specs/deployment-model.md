# Deployment model

Takos の deployment は、artifact と target を分けて考えます。

## artifact

Takos の deploy artifact は概念的に次の 2 系統です。

- worker-bundle
- container-image

worker-bundle は Cloudflare / local tenant runtime で使われ、container-image は OCI 系 backend で使われます。

## provider

Takos の deployment provider は少なくとも次を持ちます。

- `cloudflare`
- `oci`

provider は「どこに deploy するか」を表し、artifact や route contract とは別です。

## target

Takos の deployment target endpoint は次です。

- `service-ref`
- `http-url`

`service-ref` は Takos 内の service identity を指します。  
`http-url` は外部 endpoint や別 backend を指します。

tenant の canonical worker path は `service-ref` です。  
`http-url` は外部 service や OCI 系 backend のための target であり、tenant worker の正本 path ではありません。

## routing status

deployment には routing status があり、少なくとも次の状態を持ちます。

- `active`
- `canary`
- `rollback`
- `archived`

これにより、Takos は canary や rollback を deploy model に含めます。

## deploy state

deploy 処理の進行は段階的に表現されます。主な状態:

- `pending`
- `uploading_bundle`
- `creating_resources`
- `deploying_worker`
- `setting_bindings`
- `routing`
- `completed`
- `failed`
- `rolled_back`

## snapshot-based deploy

Takos の deployment は次を deployment ごとに snapshot として持ちます。

- runtime config
- bindings
- env vars

この設計により、rollback や local materialization 時に同じ execution contract を再現しやすくします。

local と Cloudflare の既知差分は [Architecture: 互換性と制限](/architecture/compatibility-and-limitations) を参照。
