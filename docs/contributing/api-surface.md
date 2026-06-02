# Takosumi route inventory

> このページでわかること: Takosumi reference kernel の route snapshot と公開
> Installer API の境界。

`../takosumi/src/service/api/openapi.ts` が Takosumi reference service の
route snapshot を保持します。Takosumi public conformance surface は
`POST /v1/installations/dry-run`、`POST /v1/installations`、
`POST /v1/installations/{id}/deployments/dry-run`、
`POST /v1/installations/{id}/deployments`、
`POST /v1/installations/{id}/rollback` の 5 endpoint です。 `/api/public/v1/*`
の Takos product gateway route は `takos` 側で管理しており、kernel 公開 API
としては扱いません。

snapshot generator は plain TypeScript object として実装してあり、kernel service
に docs / runtime 依存を増やさずに API documentation を検証できます。

snapshot がカバーする route グループ。

- プロセス probe: `GET /health`, `GET /capabilities`
- kernel installer API: `/v1/installations/*` の 5 endpoint
- Takos 側 gateway route は `takos` の public API contract で扱う
- removed plan / apply / snapshot alias は current kernel surface に含めない
- internal service API は kernel public contract として扱わない

このスナップショット生成器は route を mount しないため、router の source of
truth として扱ってはいけません。route handler は Takosumi kernel 側の API 実装
と Takos app gateway 側でそれぞれ管理します。process probe は operator /
orchestrator runtime surface であり、Installer API conformance endpoint ではあ
りません。
