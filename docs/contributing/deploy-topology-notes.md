# Deploy topology notes

## Process role alignment done here

- `takos-paas` stays a single product root and monolith. The names below are
  process roles for API, worker, router, runtime-agent, and log-worker
  execution, not separate default services.
- Added non-selector metadata for the current PaaS process roles:
  - `takos-paas-api`
  - `takos-paas-worker`
  - `takos-paas-router`
  - `takos-paas-runtime-agent`
  - `takos-paas-log-worker`
- Compose service names, Helm resource names, selectors, service DNS names,
  values keys, and command entrypoints should use the current PaaS role names.

## Remaining manual work

- Split or add the dedicated `takos-paas-log-worker` entrypoint before replacing
  any remaining generic worker entrypoints.
- Reconcile code-level task names and local environment variables with the
  current process-role names.
- Update operator runbooks for port-forward commands and dashboards keyed by
  current process-role labels.
