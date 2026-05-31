// Bun migration: supplemental Deno.* runtime shims not covered by the canonical
// deno-compat.ts. Preloaded AFTER deno-compat so it augments the same global.
//
// Gap found in takos: actions-engine's step-shell-executor.ts calls
// Deno.unrefTimer(timerId) to keep a force-kill watchdog from holding the event
// loop open. Node/Bun express the same intent via timer.unref(); since the Deno
// API takes a numeric timer id (not a Timer object), and bun's timer ids are
// objects with .unref()/.ref(), we make these tolerant no-ops that call
// unref/ref when the argument supports it. (Upstreamable to the canonical shim.)

const g = globalThis as unknown as { Deno?: Record<string, unknown> };
const Deno = (g.Deno ??= {});

if (typeof Deno.unrefTimer !== "function") {
  Deno.unrefTimer = (id: unknown): void => {
    if (id && typeof (id as { unref?: () => void }).unref === "function") {
      (id as { unref: () => void }).unref();
    }
    // numeric id (Deno semantics): no-op under bun; bun does not keep the loop
    // alive for a pending timer in a finished test the way Deno does.
  };
}

if (typeof Deno.refTimer !== "function") {
  Deno.refTimer = (id: unknown): void => {
    if (id && typeof (id as { ref?: () => void }).ref === "function") {
      (id as { ref: () => void }).ref();
    }
  };
}

export {};
