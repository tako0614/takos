import { createSignal, onCleanup, onMount } from "solid-js";

const BP_MD = 768;
const BP_LG = 1024;
const RESIZE_DEBOUNCE_MS = 150;

export interface BreakpointState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
}

export function calcBreakpointState(width: number): BreakpointState {
  return {
    isMobile: width < BP_MD,
    isTablet: width >= BP_MD && width < BP_LG,
    isDesktop: width >= BP_LG,
    width,
  };
}

const hasBrowserWindow = typeof globalThis.innerWidth === "number" &&
  typeof globalThis.addEventListener === "function" &&
  typeof globalThis.removeEventListener === "function";

const getCurrentState = () =>
  calcBreakpointState(
    typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1024,
  );

const [sharedState, setSharedState] = createSignal<BreakpointState>(
  !hasBrowserWindow
    ? { isMobile: false, isTablet: false, isDesktop: true, width: 1024 }
    : getCurrentState(),
);

let subscriberCount = 0;
let listening = false;
let debounceTimerRef: ReturnType<typeof setTimeout> | null = null;

const handleResizeDebounced = () => {
  if (debounceTimerRef) {
    clearTimeout(debounceTimerRef);
  }
  debounceTimerRef = setTimeout(() => {
    setSharedState(getCurrentState());
    debounceTimerRef = null;
  }, RESIZE_DEBOUNCE_MS);
};

function startListening() {
  if (!hasBrowserWindow || listening) return;
  globalThis.addEventListener("resize", handleResizeDebounced);
  setSharedState(getCurrentState());
  listening = true;
}

function stopListening() {
  if (!listening) return;
  globalThis.removeEventListener("resize", handleResizeDebounced);
  if (debounceTimerRef) {
    clearTimeout(debounceTimerRef);
    debounceTimerRef = null;
  }
  listening = false;
}

export function useBreakpoint(): BreakpointState {
  onMount(() => {
    subscriberCount += 1;
    startListening();

    onCleanup(() => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) {
        stopListening();
      }
    });
  });

  return {
    get isMobile() {
      return sharedState().isMobile;
    },
    get isTablet() {
      return sharedState().isTablet;
    },
    get isDesktop() {
      return sharedState().isDesktop;
    },
    get width() {
      return sharedState().width;
    },
  };
}
