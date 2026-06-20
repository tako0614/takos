# Security Policy

Please do not disclose vulnerabilities through public issues before maintainers
have had time to assess impact and prepare a fix.

Report Takos product vulnerabilities to `security@takos.jp`. The public
disclosure policy is maintained at `/legal/security-disclosure` in the docs site
and in `docs/legal/security-disclosure.md`.

Include the affected app/package, reproduction steps, impact, and any temporary
mitigation you already validated.

Never commit production secrets, private keys, or real infrastructure IDs while
preparing a report.

## Per-route rate limiting

Takos applies rate limits at two layers:

1. **Operator tier (required for self-host)**: a CDN / WAF / reverse-proxy
   limiter in front of the app. This is the primary defense against generic
   request flooding and abusive replay.
2. **Per-route limiter (`InMemoryRateLimiter` / `RateLimiters`)**: applied
   only to a small set of endpoints with specific cost / abuse profiles
   (today: `routes/index`, `routes/public-share`, `routes/spaces/storage-operations`).

Other auth-adjacent and high-cost mutation endpoints currently rely on the
operator-tier limiter only. The most security-relevant ones are annotated
inline with a `// SECURITY: ...` comment so operators auditing self-host
configuration can find them quickly:

- `POST /auth/logout` (`server/routes/auth/session.ts`)
- `POST /api/auth/logout` (`server/routes/auth-api.ts`)
- `POST /api/auth/setup-username` (`server/routes/auth-api.ts`)
- `GET  /auth/oidc/login` (`server/routes/auth/oidc.ts`)
- `GET  /auth/oidc/callback` (`server/routes/auth/oidc.ts`)
- `POST /spaces/:spaceId/threads` (`server/routes/threads/space.ts`)

If you operate Takos without an upstream CDN / WAF limiter, treat these
endpoints as the highest priority for a self-hosted limiter (e.g. an Nginx
`limit_req` zone keyed on client IP + cookie).

## Agent egress proxy (SSRF posture)

Agent outbound HTTP goes through the egress worker, which fails closed against
SSRF: the destination IP is resolved via DoH and rejected when it is private,
loopback, link-local, cloud-metadata (`169.254.169.254`), CGNAT, or an
IPv6 / NAT64 / 6to4 form wrapping any of those (see `isPrivateIP`,
regression-tested in `platform-utils/__tests__/validation.test.ts`). The egress
worker is reached only as a service binding — it has **no public route** — and
responses cap size and use `redirect: 'manual'`.

Accepted residual (documented, not a regression): after the DoH IP check, the
final `fetch()` re-resolves the hostname through the Workers platform resolver
and is **not pinned** to the validated IP, because the Workers runtime offers no
portable way to pin a fetch to a literal IP while preserving Host/SNI. A
short-TTL DNS rebind could therefore answer a public IP to the probe and a
private IP to the edge resolver. Both lookups traverse Cloudflare's resolver,
which narrows this to a short-TTL-flip race. Operators who must eliminate it
should restrict the egress worker's reachable network at the platform layer.
This closes once the Workers runtime supports literal-IP + Host/SNI fetches.
