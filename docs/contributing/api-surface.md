# Takosumi API surface

> このページでわかること: Takosumi kernel の公開 API エンドポイント一覧。

`../takosumi/packages/kernel/src/api/openapi.ts` が Takosumi の公開 route を表す依存ゼロの OpenAPI 風 JSON snapshot を保持します。kernel の installer public contract は `POST /v1/installations/dry-run`、`POST /v1/installations`、`POST /v1/installations/{id}/deployments/dry-run`、`POST /v1/installations/{id}/deployments`、`POST /v1/installations/{id}/rollback` です。`/api/public/v1/*` の Takos プロダクト gateway route は `takos/app` 側で管理しており、kernel 公開 API としては扱いません。

snapshot generator は plain TypeScript object として実装してあり、kernel service に docs / runtime 依存を増やさずに API documentation を検証できます。

カバーする route グループ。

- プロセス: `GET /health`, `GET /capabilities`
- kernel installer API: `/v1/installations/*` の 5 endpoint
- Takos 側 gateway route は `takos/app` の public API contract で扱う
- removed plan / apply / snapshot alias は current kernel surface に含めない
- internal service API は kernel public contract として扱わない

このスナップショット生成器は route を mount しないため、router の source of truth として扱ってはいけません。route handler は Takosumi kernel 側の API 実装と Takos app gateway 側でそれぞれ管理します。
