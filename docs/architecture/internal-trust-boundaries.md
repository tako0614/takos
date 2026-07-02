# Internal Trust Boundaries (canonical mechanism)

**Premise: Takos is the OpenTofu-native AI workspace distribution managed by external Takosumi control plane.** Takosumi is the OpenTofu-native deploy control plane; Takos's whole
deploy topology — the worker, its Durable Objects, the egress proxy, container callback endpoints, container execution,
bindings, and routes — is an OpenTofu module that **Takosumi installs and applies** (Capsule -> `plan` type Run ->
`apply` type Run -> StateVersion / Output), with a **ProviderConnection / ProviderBinding / policy** owning the provider
credentials, state backend, and Cloudflare Container execution. The trust boundaries here are properties of that
Takosumi-applied topology; they do not depend on, and are not owned by, any single hand-written deploy file. The module
lives in `deploy/opentofu` (`var.target = cloudflare`); the `cloudflare` target
provisions the backing resources (D1 / KV / R2 / Queues) and the Worker-script layer consumes the resulting binding map.
`takosumi-private/platform/wrangler.toml` plus operator-local secrets outside the repo is the interim reference
materialization of that same topology.

At runtime Takos deploys as **one Worker** (`src/worker/index.ts`). Because a single worker serves both the public
internet edge (`web.fetch` on the admin domain) and self/binding traffic, "is this request internal?" **cannot** be
decided by a header — an external client can forge any header. This page is the canonical decision for how trust is
established for every call that crosses an isolate/process boundary.

## The rule: classify by the real boundary, not by a header

There are exactly **three** kinds of cross-boundary call. Each has ONE mechanism.

### 1. Trusted intra-worker call → NO application auth (the transport is the boundary)

Worker code calling its **own Durable Objects** (`SessionDO`, `RunNotifierDO`, `NotificationNotifierDO`, `RateLimiterDO`,
`RoutingDO`, the container-host DOs) or the **egress proxy** (`runtime/worker/egress.ts`, reached only through the
`TAKOS_EGRESS` service binding — `runtime-factory.ts`: "service-binding only, no public routes").

A Durable Object stub / service binding is **only reachable by code that holds the binding** — i.e. the worker's own
code. External clients cannot obtain a stub. Therefore the binding/stub IS the trust boundary and **no marker, no secret,
no signature is required or wanted.** Adding header auth here is theater that invites the forgeable-header bug.

- Status: **DONE.** `X-Takos-Internal-Marker` is no longer an auth gate anywhere: `validateContainerAuth` (audit #10) is
  deleted, `notifier-base.isAuthorizedHttp` returns `true` (binding boundary), and the **egress** proxy
  (`runtime/worker/egress.ts`) no longer requires the marker either — the real deploy binds `TAKOS_EGRESS` to a separate,
  binding-only operator egress worker (`workers_dev = false`), so the binding is the boundary and egress's own
  SSRF guards (private-IP / port / protocol / redirect / credential blocking) carry outbound safety. The only remaining
  `X-Takos-Internal-Marker` references are defensive inbound strips (`dispatch.ts:79`, header strip-lists) — nothing reads
  it as trust.
- **ACCEPTED RESIDUAL RISK — egress DNS-rebinding TOCTOU.** `egress.ts` resolves the target via DoH and rejects
  private/internal IPs, but the subsequent `fetch()` re-resolves the hostname through the Workers platform resolver and is
  **not pinned** to the validated IP — the Workers runtime offers no portable way to pin a fetch to a literal IP while
  preserving correct Host/SNI. A hostname that answers a public IP to the DoH probe and a private IP (or a short-TTL flip)
  to the edge resolver could therefore bypass the private-IP gate. Both lookups traverse Cloudflare's own resolver, which
  narrows this to a short-TTL-flip race rather than a wide-open hole. **Mitigations in place:** the private-IP gate on the
  DoH result, `redirect: 'manual'`, and per-space egress rate limiting (shrinks the rebinding window). **Operator
  mitigation (required for hard isolation):** deploy egress behind a network egress DMZ / firewall that itself blocks RFC1918
  - link-local + metadata-endpoint destinations, so a rebind cannot reach internal addresses even if the in-worker gate is
    raced. Revisit the in-worker pinning if/when Workers exposes IP-pinned fetch for arbitrary hostnames.
- **DEPLOY INVARIANT — Takos is OpenTofu-native and Takosumi-managed.** Takos deploy topology is a plain OpenTofu module;
  external Takosumi deploy-control installs and applies it as a Capsule (Capsule -> `plan` type Run -> `apply` type Run
  -> StateVersion / Output), with ProviderConnections holding credential references, ProviderBindings resolving each
  provider (+ optional alias) to an explicit ProviderConnection, and policy resolving provider allowlists, state backend,
  and Cloudflare Container execution; the non-secret service URLs / binding map are recorded as **Output**. The
  trust-boundary invariants below are therefore **properties of that module, validated by the reviewed plan** — not of
  hand-maintained wrangler. (`takosumi-private/platform/wrangler.toml` plus operator-local secrets outside the repo is the interim reference
  materialization of the same topology and converges onto the Takosumi-applied module; do not treat it as a separate
  source of truth.)
  - The **egress** service MUST be binding-only — no public route (`workers_dev = false`). Tier 1: only worker code holds
    the `TAKOS_EGRESS` binding, so the binding is the boundary.
    - **Profile scope.** The "binding is the boundary" claim holds for the **Cloudflare profile**, where `TAKOS_EGRESS` is
      a service binding. On the **node-postgres / self-host profile** the worker reaches egress **by URL**
      (`TAKOS_EGRESS_URL`, resolved in `node-platform/resolvers/dispatch-resolver.ts`) — there is no binding, and after the
      marker removal there is no application-layer auth on that hop either. Its boundary is therefore a **deploy
      network-isolation invariant**: the egress URL MUST NOT be reachable from untrusted networks (only the worker process
      may reach it), backed by egress's own SSRF guards. This invariant is owned by the deploy materialization
      (`takosumi-private` / operator-local config) and MUST be asserted there (egress URL not publicly routable); it is **not** enforced by worker
      code. Until that is verified in staging, treat node-profile egress as URL-reachable and keep it network-isolated.
  - The **container callback endpoints exposed by the single worker** MUST stay URL-reachable from the untrusted
    agent/actions containers: containers call back by URL (`PROXY_BASE_URL`, `TAKOS_AGENT_CONTROL_RPC_BASE_URL`) because a
    Cloudflare Container cannot hold a service binding. Their boundary is the **per-run token (tier 2)**, not the binding
    — making them binding-only breaks container callbacks. This is exactly why tier 2 (a real credential) exists where
    tier 1 (binding boundary) cannot apply, and why Takosumi's ProviderConnection / ProviderBinding / policy —
    not a separate runtime service — owns the container execution + credentials.
- Invariant: never re-introduce a header that converts an intra-worker call into "trusted". If a future DO needs to
  distinguish callers, encode it as a typed argument, not a spoofable header.

### 2. Untrusted execution container → worker → per-run capability token (authenticating an untrusted party)

The **agent and actions/workflow containers run untrusted / user-supplied code** and call back via
`/api/internal/v1/agent-control/*` → `/internal/executor-rpc/*`. This is NOT "internal auth" — it is authenticating an
untrusted party, so it keeps a real credential:

- a **per-run proxy token** verified against the issuing host (`executor-host.ts` `verifyProxyToken`), with
  `body.runId`/`serviceId` **overwritten from the verified token** and `claimsMatchRequestBody` failing closed;
- every control-RPC handler derives **tenant + thread + identity from the token-bound run, never from the request body**
  (`resolveRunThreadTenant`, `getRunBootstrap`, and the TIER A binding) — a compromised container cannot target another
  tenant;
- least privilege: secrets forwarded to a workflow container are limited to those the job references
  (`collectReferencedSecretNames`).
- Target hardening (tracked, not yet done): split the single coarse `ProxyCapability="control"` into per-purpose scopes
  and give workflow/actions runs a smaller set than agent runs; gate workflow-container egress deny-by-default.

### 3. Cross-service implementation calls → worker → ONE signed-envelope

Takos still has product-internal implementation calls such as scheduled jobs, default-app distribution checks, and
agent-control backend calls. They are not Takosumi's canonical `/internal/*` public route family; Takosumi reserves
`/internal/*` HTTP routes for runner / executor container callbacks inside each worker. Closed hosted deployments may
have provider endpoint bridges outside the OSS/Takos self-host public model, but those routes are not Takos product
routes and are not a Takosumi OSS customer API. When Takos product code crosses a real service or trust-domain boundary,
it must use a signed request envelope
rather than a route name or header marker.

- **Canonical mechanism: the `takos-internal-v3` HMAC signed-request envelope**
  (`verifyTakosumiInternalRequestFromHeaders`): signature over method + path + body, with `caller` / `audience` /
  `capabilities` / nonce / timestamp (replay-protected). It already backs `/internal/executor-rpc` (signed-backend mode)
  and `/api/internal/v1/agent-control-backend`.
- **Decision:** the signed envelope is the ONE cross-service primitive. The ad-hoc plain-secret gates —
  `validateInternalApiAccess` (hostname + `X-Takos-Internal-Secret`) and the executor-proxy plain
  `EXECUTOR_PROXY_SECRET` mode — converge
  onto it. They are load-bearing today (the plain secret is the only gate against Host-spoof/DNS-rebind), so removal is
  gated on the callers (Takosumi Accounts / deploy-control, with operator-private config outside this repo) sending the signed envelope.

## What "internal auth is unnecessary" means precisely

It is true for **tier 1** (intra-worker) — and that is where the marker lived, now removed. It is **false** for tiers 2/3:
those cross a genuine trust boundary (untrusted code, or a separate service) and keep a credential. The clean end-state is
not "zero auth" but "**no header markers; the binding is the boundary where there is one, and a single signed-envelope /
per-run token where a trust boundary is actually crossed.**"

## Execution status & remaining contract

- Tier 1: **complete on the Cloudflare profile** (marker eliminated; binding boundary; audit #10 closed by deletion).
  Caveat: on the **node-postgres / self-host profile** the worker→egress hop is URL-reachable, not a binding, so its
  boundary is a deploy network-isolation invariant (egress URL not publicly routable) that must be asserted in
  `takosumi-private` staging evidence — see the egress profile-scope note above.
- Tier 2: cross-tenant binding + least-privilege secrets **complete**; capability-split + workflow-egress gate tracked.
- Tier 3: signed envelope **exists and is canonical for Takos product cross-service implementation calls**; collapsing the plain-secret gates onto it requires the
  cross-repo operator callers to send the envelope, then a topology step so `/internal/*` and egress are reachable only
  via their binding/entrypoint. These are **deploy-environment changes** (validate in `takosumi-private` staging evidence), not
  worker-local edits.
- Optional transport upgrade: tiers 1/2 may later move from `.fetch(Request)` over bindings to native Cloudflare RPC
  (WorkerEntrypoint / DO RPC) for typed, header-free calls. This is cleanliness only — the marker is already gone, so it
  carries no remaining security benefit — and must be done as a cohesive change with local-emulation parity proven by
  `bun test`.
