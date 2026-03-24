# 運用モデル

## local と staging / production

Takos の運用では、少なくとも次の面を区別して考えます。

- local: 検証と再現
- staging: 実 provider 上での検証
- production: 本番運用

## local の意味

local は単なる UI preview ではなく、Takos の control plane と tenant runtime contract を検証する面です。  
特に proxyless smoke は、Cloudflare 固有 path が control plane に逆流していないかを見る重要な確認です。

local backend の既知差分と制限は [互換性と制限](/architecture/compatibility-and-limitations) にまとめています。

## Cloudflare の意味

Cloudflare は主要な provider / runtime backend の 1 つです。  
worker bundle deploy, routing, logs, rollback を現実の backend で確認する場所になります。

## rollback と canary

Takos の deployment model は rollout state を持ちます。  
運用では、`active`, `canary`, `rollback`, `archived` の routing 状態と、deployment event を見るのが基本です。

## operator が見るべき signal

- deployment status
- deploy state
- routing status
- health endpoint
- run follow / event stream
- local proxyless 結果

## tracked config の扱い

repo に含まれる tracked config は template です。  
実運用では resource ID, domain, secret, callback URL などを実値に置き換える必要があります。
