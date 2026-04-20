/**
 * Backward-compatible alias for the common-env dependency assembly entrypoint.
 *
 * New code should import from `./deps`.
 */
export { type CommonEnvDeps, createCommonEnvDeps } from "./deps.ts";
