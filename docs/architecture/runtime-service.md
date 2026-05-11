# Runtime Compatibility Notes

This page is kept for legacy links. `takos-runtime-service` is not a current
Takos product service.

Current ownership is split by substitutability:

- workflow files, `workflowRef`, artifact build, and manifest compile are owned
  by `takosumi-git`
- Git Smart HTTP / refs / objects are owned by `takos/git`
- agent execution is owned by `takos/agent`
- deploy / runtime lifecycle semantics are owned by the generic `takosumi`
  kernel and its runtime-agent connector model

The current local service set is `takos-app`, `takosumi`, `takos-git`,
`takos-agent`, `postgres`, and `redis`. See
[Service Topology](./service-topology.md) for the active architecture.
