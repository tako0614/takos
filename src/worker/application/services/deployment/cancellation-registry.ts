/**
 * Deployment cancellation registry.
 *
 * Maps an in-flight deployment id to its AbortController so a cancel
 * request can trigger abort() on the running pipeline. This is an
 * **in-process** registry: a deployment running in another isolate / replica
 * cannot be cancelled through this path. Honest scope:
 *
 * - Cloudflare Workers: each request runs in an isolate. Queue consumers run
 *   in a different isolate from HTTP handlers, so the cancel route cannot
 *   reach a deploy that was dispatched via DEPLOY_QUEUE. The current code
 *   falls back to inline execution when queue dispatch fails — those inline
 *   deploys ARE cancellable from the same isolate that started them.
 * - Single-process self-host (local dev / non-Cloudflare runtimes): all
 *   deploys share one registry and are reachable from the cancel route.
 *
 * Cross-isolate cancellation is handled by the DB-backed
 * `deployments.cancellation_requested_at` flag. This registry remains the
 * low-latency same-isolate path so inline deploys can be interrupted without
 * waiting for the next DB poll.
 */

const controllers = new Map<string, AbortController>();

/**
 * Register an AbortController for the given deployment id. Returns the
 * controller so the caller can pass `controller.signal` into the pipeline.
 * If an entry already exists for `deploymentId` it is replaced — the prior
 * controller's signal is NOT aborted (callers that need fan-out should use
 * `combineSignals`).
 */
export function registerDeploymentController(
  deploymentId: string,
): AbortController {
  const controller = new AbortController();
  controllers.set(deploymentId, controller);
  return controller;
}

/**
 * Remove the registry entry for a completed (success/failed) deployment.
 * Safe to call when no entry exists. Should always be invoked from a
 * `finally` block.
 */
export function unregisterDeploymentController(deploymentId: string): void {
  controllers.delete(deploymentId);
}

/**
 * Trigger cancellation of an in-flight deployment. Returns `true` if a
 * controller was found and aborted, `false` if no in-flight deployment is
 * registered (already complete, never started, or running in a different
 * isolate).
 */
export function cancelDeployment(
  deploymentId: string,
  reason?: string,
): boolean {
  const controller = controllers.get(deploymentId);
  if (!controller) return false;
  controller.abort(reason ?? "deployment-cancelled");
  return true;
}

/**
 * Test-only: clear all entries. Production code should rely on
 * `unregisterDeploymentController` from per-deployment cleanup.
 */
export function _resetDeploymentControllersForTest(): void {
  controllers.clear();
}
