# Deploy topology notes

## Process role alignment done here

- `takos-paas` stays a single product root and monolith. The names below are
  process roles for API, worker, router, runtime-agent, and log-worker
  execution, not separate default services.
- Added non-selector metadata for the current PaaS process roles:
  - `control-web` / `controlWeb` -> `takos-paas-api`
  - `control-worker` / `controlWorker` -> `takos-paas-worker`
  - `control-dispatch` / `controlDispatch` -> `takos-paas-router`
  - `runtime-host` and legacy `runtime` workload metadata ->
    `takos-paas-runtime-agent`
  - legacy `executor` workload metadata -> `takos-paas-log-worker`
- Kept existing Compose service names, Helm resource names, selectors, service
  DNS names, values keys, and command entrypoints stable for compatibility.
- Treat `control-*`, `runtime-host`, `runtime`, and `executor` names as
  deploy/runtime compatibility roots until a resource-name migration plan covers
  operator-facing DNS names, selectors, dashboards, and port-forward commands.

## Remaining manual work

- Decide the cutover plan for renaming compatibility keys and Kubernetes
  resources from `control-*`, `runtime`, and `executor` to role-native names.
  This needs an upgrade/migration plan because Deployment selectors and Service
  DNS names are externally observable.
- Split or add the dedicated `takos-paas-log-worker` entrypoint before replacing
  executor workload semantics. The current chart only marks legacy executor
  metadata and does not change its behavior.
- Reconcile `runtime-host` versus `takos-paas-runtime-agent` naming in
  code-level task names and local environment variables before changing service
  DNS or env var names.
- Update operator runbooks after the resource-name migration plan is approved,
  including port-forward commands and dashboards keyed by legacy component
  labels.
