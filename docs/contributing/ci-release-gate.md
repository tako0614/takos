# CI Release Gate

Takos uses the root `.github/workflows/pr-check.yml`,
`.github/workflows/ci.yml`, and `.github/workflows/release-gate.yml` workflows
as credential-free release gates before staging / production promotion.

The workflows set up Deno, Helm, Terraform, and a local kind cluster, then run
the Takos product shell validators:

1. `deno task check`
2. `deno task validate:agent-docs`
3. `deno task validate:architecture`
4. `deno task validate:process-roles`
5. distribution / observability / patch / migration / legal validators
6. `deno task validate:release-promotion`
7. Helm chart, Helm overlay, and Terraform plan gates
8. docs build and release manifest generation

The CI jobs do not read production secrets, deploy to production, or contact live
cloud APIs. Live staging / production deploy execution remains in
`takos-private/` and requires the sign-off evidence described in
`/operations/release-promotion`.
