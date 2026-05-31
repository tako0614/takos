/**
 * Public barrel for takos-worker-local-platform.
 *
 * All canonical implementations live in `../../../local-platform/`.
 * This package provides re-exports and entrypoint scripts.
 */
export * from "../../../local-platform/runtime.ts";
export * from "../../../local-platform/local-server.ts";
export * from "../../../local-platform/worker.ts";
export * from "../../../local-platform/oci-orchestrator.ts";
