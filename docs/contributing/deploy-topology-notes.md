# Deploy topology notes

## Service-set alignment done here

- The Takos product service set is `takos-app`, `takosumi`, `takos-git`, and
  `takos-agent`.
- `takos-app` is the public Web/API gateway. Browser and CLI clients should
  enter through `takos-app`, which calls the owning internal services.
- `takosumi` remains the generic kernel service. Its internal process-role
  layout is not modeled as top-level Takos Helm workloads.
- Helm resource names, selectors, service DNS names, values keys, and ingress
  backend wiring should use the Takos service IDs above.

## Remaining manual work

- Keep older Takosumi process-role names only in historical notes or
  Takosumi-internal implementation docs.
- Update operator dashboards and port-forward snippets to key off
  `takos.io/service-id`.
