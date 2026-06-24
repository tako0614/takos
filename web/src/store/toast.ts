import { createSignal } from "solid-js";
import type { Toast } from "../types/index.ts";

const DEFAULT_DURATION_MS = 4000;
// Cap the visible stack so a burst of errors can't fill (and overflow) the
// screen — older toasts are dropped as new ones arrive.
const MAX_TOASTS = 4;

const [toasts, setToasts] = createSignal<Toast[]>([]);

interface TimerState {
  handle: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  remaining: number;
}

const timers = new Map<string, TimerState>();

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer?.handle != null) clearTimeout(timer.handle);
  timers.delete(id);
}

function dismissToast(id: string) {
  clearTimer(id);
  setToasts((prev) => prev.filter((toast) => toast.id !== id));
}

function scheduleDismiss(id: string, ms: number) {
  clearTimer(id);
  const handle = setTimeout(() => dismissToast(id), ms);
  timers.set(id, { handle, startedAt: Date.now(), remaining: ms });
}

/** Freeze a toast's auto-dismiss countdown (e.g. while hovered/focused). */
function pauseToast(id: string) {
  const timer = timers.get(id);
  if (!timer || timer.handle == null) return;
  clearTimeout(timer.handle);
  const elapsed = Date.now() - timer.startedAt;
  timers.set(id, {
    handle: null,
    startedAt: timer.startedAt,
    remaining: Math.max(0, timer.remaining - elapsed),
  });
}

/** Resume a paused toast's countdown from where it left off. */
function resumeToast(id: string) {
  const timer = timers.get(id);
  if (!timer || timer.handle != null) return;
  scheduleDismiss(id, timer.remaining > 0 ? timer.remaining : DEFAULT_DURATION_MS);
}

function showToast(type: Toast["type"], message: string) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setToasts((prev) => {
    const next = [...prev, { id, type, message }];
    // Drop the oldest toasts (and their timers) beyond the cap.
    while (next.length > MAX_TOASTS) {
      const removed = next.shift();
      if (removed) clearTimer(removed.id);
    }
    return next;
  });
  scheduleDismiss(id, DEFAULT_DURATION_MS);
  return id;
}

export function useToast() {
  return {
    get toasts() {
      return toasts();
    },
    showToast,
    dismissToast,
    pauseToast,
    resumeToast,
  };
}
