import type { PlatformServices } from "./platform-config.ts";

/**
 * SSE notifier is a Node-only service (the Workers runtime uses Durable
 * Objects instead). It is injected onto the env object as an opaque property
 * by the Node platform's `env-builder.ts`, but does not appear on the typed
 * `Env`/`WorkerEnv`/`DispatchEnv` interfaces because those describe the
 * Workers provider surface. Consumers therefore need an untyped lookup with
 * a runtime predicate; this module centralizes that boundary so the rest of
 * the codebase reads SSE_NOTIFIER through one typed accessor.
 */

type SseNotifier = NonNullable<PlatformServices["sseNotifier"]>;

function isSseNotifier(value: unknown): value is SseNotifier {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { emit?: unknown; subscribe?: unknown };
  return typeof candidate.emit === "function" &&
    typeof candidate.subscribe === "function";
}

export function getSseNotifier(env: unknown): SseNotifier | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  const candidate = Reflect.get(env, "SSE_NOTIFIER");
  return isSseNotifier(candidate) ? candidate : undefined;
}
