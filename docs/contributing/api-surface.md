# Takosumi route inventory

> このページでわかること: Takosumi reference kernel の route snapshot と公開
> deploy-control API の境界。

`../takosumi/src/service/api/openapi.ts` が Takosumi reference service の
route snapshot を保持します。Takosumi public conformance surface は
Installation / Run / Deployment / OutputSnapshot を扱う
deploy-control API です。 `/api/public/v1/*` の Takos product gateway route は
`takos` 側で管理しており、Takosumi 公開 API としては扱いません。

snapshot generator は plain TypeScript object として実装してあり、kernel service
に docs / runtime 依存を増やさずに API documentation を検証できます。

snapshot がカバーする route グループ。

- プロセス probe: `GET /health`, `GET /capabilities`
- deploy-control API: Installation / Run / OutputSnapshot routes
- Takos 側 gateway route は `takos` の public API contract で扱う
- removed plan / apply / snapshot alias は current kernel surface に含めない
- internal service API は kernel public contract として扱わない

このスナップショット生成器は route を mount しないため、router の source of
truth として扱ってはいけません。route handler は Takosumi kernel 側の API 実装
と Takos app gateway 側でそれぞれ管理します。process probe は operator /
orchestrator runtime surface であり、deploy-control conformance endpoint ではあ
りません。
