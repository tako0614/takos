# 互換性と制限

Takos は `Cloudflare` と `local` の両方で同じ product contract を扱います。  
ただし backend は同一ではないため、完全一致ではなく「何を揃え、何を差分として扱うか」を明示しておく必要があります。

## 何を揃えるか

Takos が parity の対象にしているのは次です。

- tenant artifact は `worker-bundle`
- tenant routing target は `service-ref` と `http-url`
- deployment は `active`, `canary`, `rollback`, `archived` を持つ
- weighted routing は `routeRef` だけでなく deployment identity も保持する
- deployment ごとの snapshot
  - runtime config
  - bindings
  - env vars
- dispatch を経由して tenant runtime に到達する request contract

つまり、Takos は local でも Cloudflare でも「同じ worker-bundle contract を実行する」ことを目指します。

## local と Cloudflare の役割

### Cloudflare

Cloudflare は主要な production backend です。

- actual provider
- actual Workers backend
- actual deploy / rollback / routing backend

### local

local は検証用 backend です。

- Cloudflare account なしで control plane を起動できる
- tenant worker contract を local で materialize できる
- smoke / proxyless smoke で canonical path を検証できる

## 意図的に残している差分

### local control plane は Node-backed

local の control plane は Node-backed です。  
これは control plane の起動性と local DX を優先した設計です。

### local tenant runtime は Workers-compatible adapter

local の tenant runtime は Workers-compatible ですが、Cloudflare backend と byte-for-byte 同一ではありません。  
local は `worker-bundle` を local adapter 上で materialize して実行します。

### infra host は URL forward を使う

local の URL forward は tenant worker の canonical path ではなく、主に infra host 用です。

- `runtime-host`
- `executor-host`
- `browser-host`
- `takos-egress`

`worker-bundle` の tenant service は local でも worker runtime で解決します。

同じ `service-ref` を指す `active` / `canary` / `rollback` が並ぶ場合も、local は routing target に含まれる deployment identity を使って worker runtime を選びます。

## local でできないこと、差分が出うること

- Cloudflare platform 固有の内部最適化や実装差
- backend ごとの performance 特性
- Cloudflare 上の実 resource behavior を完全に再現すること
- production traffic 上での最終的な実証

local は production backend の代替ではなく、product contract を大きく崩さずに検証するための backend です。

## operator への意味

実運用では次の使い分けになります。

- local: 早い検証、smoke、proxyless 確認
- staging: actual provider 上での deploy / routing / rollback 検証
- production: 実 traffic と実 resource を扱う本番運用

local が green でも、provider 固有の最終確認は staging / production backend で行う必要があります。

## 設計上の決定

Takos は次を正本方針にしています。

- public surface は `/workers`
- internal model は `service / route / deployment`
- local control plane は Node-backed
- tenant runtime は Workers-compatible
- Cloudflare-specific behavior は provider / adapter に閉じ込める

この方針により、「Cloudflare でしか動かない構造」は避けつつ、「tenant は Workers 技術を使う」という軸は維持します。
