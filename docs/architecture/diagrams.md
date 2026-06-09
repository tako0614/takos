# Architecture Diagrams

**Takos is self-hostable as a plain OpenTofu module; Takosumi is optional.** Takosumi is the OpenTofu-native deploy control plane: Takos's deploy
topology is a plain OpenTofu module (`deploy/opentofu`, `var.target` ∈ `aws | gcp | cloudflare`)
that Takosumi **installs and applies**, recording the run ledger as **Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution.

## Deploy flow (Takosumi run ledger)

```mermaid
flowchart LR
  M["Takos OpenTofu module<br/>deploy/opentofu (var.target)"]
  subgraph TS["Takosumi (deploy control plane)"]
    I["Installation"]
    P["`plan` type Run<br/>(tofu plan)"]
    A["`apply` type Run<br/>(tofu apply / destroy)"]
    D["Deployment"]
    O["OutputSnapshot<br/>(non-secret URLs / binding map)"]
  end
  RP["Connection / ProviderBinding / policy<br/>provider allowlist · credentials ·<br/>state backend · Container execution"]
  M --> I --> P --> A --> D --> O
  RP -. owns execution & credentials .-> P
  RP -. owns execution & credentials .-> A
```

For the `cloudflare` target, the applied module provisions the backing resources (D1 / KV / R2 / Queues) and the
Worker-script layer consumes the resulting binding map. The hand-maintained
`takos-private/cloudflare/wrangler.*.toml` (and the helm / distribute pipeline) is the **interim reference
materialization** of this same topology, converging onto the Takosumi-applied module — not a separate source of truth.

## Runtime shape (one Worker)

```mermaid
flowchart TB
  Edge["Public edge<br/>web.fetch (admin domain)"]
  W["Takos Worker<br/>src/worker/index.ts"]
  DO["Own Durable Objects<br/>(Session / RunNotifier / RateLimiter / Routing / container-host)"]
  Eg["Egress proxy<br/>TAKOS_EGRESS (binding-only)"]
  RH["runtime-host / executor<br/>(publicly reachable, per-run token)"]
  C["Agent / actions containers<br/>(untrusted, Cloudflare Container)"]
  Op["Operator / account-plane<br/>(takosumi-internal-v3 signed envelope)"]

  Edge --> W
  W -- binding boundary (tier 1) --> DO
  W -- service binding (tier 1) --> Eg
  C -- per-run token (tier 2) --> RH
  RH --> W
  Op -- signed envelope (tier 3) --> W
```

Trust boundaries are properties of this Takosumi-applied topology, validated by the reviewed plan. See
[Internal trust boundaries](./internal-trust-boundaries.md) for the canonical decision on tier 1 (binding boundary),
tier 2 (per-run capability token), and tier 3 (signed-request envelope).

## Boundary

Takos owns the product surface (chat, agent, memory, spaces, Git hosting, bundled-app launcher metadata, file-handler
metadata, MCP-facing product metadata). Takosumi records the run ledger (Installation / Run / Deployment /
OutputSnapshot) and the Connection / ProviderBinding / policy-owned execution. The operator distribution / Takosumi Accounts owns
account-plane policy: account, billing, OIDC, and dashboard.

## References

- [Deploy overview](/deploy/)
- [Internal trust boundaries](./internal-trust-boundaries.md)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
