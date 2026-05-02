# Takosumi API surface

`apps/paas/src/api/openapi.ts` owns a dependency-free OpenAPI-ish JSON snapshot
for the current Takosumi mounted route surface. It is intentionally a plain
TypeScript object generator so API documentation can be checked without adding a
docs/runtime dependency to the PaaS service.

Covered route groups:

- process: `GET /health`, `GET /capabilities`
- public API documentation aliases: `/api/spaces`, `/api/groups`,
  `/api/deploy/plans`, `/api/deploy/applies`
- current mounted public route constants are preserved under
  `x-takos-mounted-path` / `x-takos-public-mounted-paths`
- internal service API: `/internal/spaces`, `/internal/groups`,
  `/internal/deploy/plans`, `/internal/deploy/applies`

The generator does not mount routes and must not be treated as router source of
truth. Route handlers remain in `public_routes.ts` and `internal_routes.ts`.
