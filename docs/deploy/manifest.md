# OpenTofu App Source

Takos app source is OpenTofu-native. A repository does not need `.takosumi` or
another Takos-specific manifest file. The app exposes deploy intent through
OpenTofu outputs, and Takos reads the evaluated JSON from `tofu output -json`.

## Canonical Output

Use an `output "takos_app_manifest"` block:

```hcl
output "takos_app_manifest" {
  value = {
    name    = "notes"
    version = "1.0.0"

    compute = {
      web = {
        kind  = "worker"
        image = "ghcr.io/example/notes@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      }
    ]

    publish = [
      {
        name      = "ui"
        publisher = "web"
        type      = "takos.ui-surface.v1"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
      }
    ]

    env = {}
  }
}
```

`takos_app` is accepted as a short alias, but new sources should use
`takos_app_manifest`.

## Source Detection

Takos treats these files as installable OpenTofu source signals, in order:

- `main.tf`
- `outputs.tf`
- `takos.tf`
- `opentofu/main.tf`
- `opentofu/outputs.tf`
- `infra/main.tf`
- `infra/outputs.tf`
- `package.json` as the legacy fallback

OpenTofu modules may use variables, locals, and modules. Takos only consumes the
evaluated output JSON, not raw HCL.

## Boundary

OpenTofu state, provider credentials, resource apply, OIDC clients, billing,
domains, and the provider allowlist belong to a Takosumi Connection / ProviderBinding / policy, the
operator distribution, or `takos-private`. Takos consumes the app output, and
Takosumi records the run ledger — Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment — for each plan and apply.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi v1](https://takosumi.com/docs/reference/takosumi-v1)
