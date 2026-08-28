# Takoserver fetch tracer (experimental)

This directory is an opt-in, source-build development tracer for validating a
Takos Worker lifecycle against a Provider 4 Takoform Host. It is deliberately
not the Takos product runtime, the default OpenTofu module, a published
artifact, or publication/live release evidence.

The tracer creates only the five Worker resources named by the Provider 4
contract (`takoform_module_worker`, `takoform_worker_bundle`,
`takoform_worker_version`, `takoform_worker_deployment`, and
`takoform_worker_endpoint`), checks exact v1 discovery/readback identities,
probes the returned Worker, then destroys the graph and proves exact absence.
The runner supplies a per-run `project_name`, so all resource names are
isolated even when disposable Space runs overlap. A `.invalid` assigned
hostname is never treated as Host-runtime evidence: the runner imports this
fixture's Worker module and serves a loopback-only diagnostic probe so the
build identity/config contract can still be checked locally.
The runner supplies a local Provider binary through an OpenTofu dev override;
no provider package, token, or generated state belongs in this directory.
