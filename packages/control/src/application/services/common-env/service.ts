/**
 * Backward-compatible alias for the common-env dependency assembly entrypoint.
 *
 * New code should import from `./deps`.
 */
export { createCommonEnvDeps, type CommonEnvDeps } from './deps';
