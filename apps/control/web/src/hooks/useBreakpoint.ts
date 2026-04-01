import { createSignal, onMount, onCleanup } from 'solid-js';

const BP_MD = 768;
const BP_LG = 1024;
const RESIZE_DEBOUNCE_MS = 150;

interface BreakpointState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
}

function calcBreakpointState(width: number): BreakpointState {
  return {
    isMobile: width < BP_MD,
    isTablet: width >= BP_MD && width < BP_LG,
    isDesktop: width >= BP_LG,
    width,
  };
}

export function useBreakpoint(): BreakpointState {
  const hasBrowserWindow = typeof globalThis.matchMedia === 'function';
  const [state, setState] = createSignal<BreakpointState>(
    !hasBrowserWindow
      ? { isMobile: false, isTablet: false, isDesktop: true, width: 1024 }
      : calcBreakpointState(globalThis.innerWidth),
  );

  let debounceTimerRef: ReturnType<typeof setTimeout> | null = null;

  const handleChange = () => {
    setState(calcBreakpointState(globalThis.innerWidth));
  };

  const handleResizeDebounced = () => {
    if (debounceTimerRef) {
      clearTimeout(debounceTimerRef);
    }
    debounceTimerRef = setTimeout(() => {
      setState(calcBreakpointState(globalThis.innerWidth));
      debounceTimerRef = null;
    }, RESIZE_DEBOUNCE_MS);
  };

  onMount(() => {
    if (!hasBrowserWindow) return;

    const mdQuery = globalThis.matchMedia(`(min-width: ${BP_MD}px)`);
    const lgQuery = globalThis.matchMedia(`(min-width: ${BP_LG}px)`);

    mdQuery.addEventListener('change', handleChange);
    lgQuery.addEventListener('change', handleChange);
    globalThis.addEventListener('resize', handleResizeDebounced);

    onCleanup(() => {
      mdQuery.removeEventListener('change', handleChange);
      lgQuery.removeEventListener('change', handleChange);
      globalThis.removeEventListener('resize', handleResizeDebounced);
      if (debounceTimerRef) {
        clearTimeout(debounceTimerRef);
      }
    });
  });

  return state();
}
