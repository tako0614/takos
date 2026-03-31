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
  const [state, setState] = createSignal<BreakpointState>(
    typeof window === 'undefined'
      ? { isMobile: false, isTablet: false, isDesktop: true, width: 1024 }
      : calcBreakpointState(window.innerWidth),
  );

  let debounceTimerRef: ReturnType<typeof setTimeout> | null = null;

  const handleChange = () => {
    setState(calcBreakpointState(window.innerWidth));
  };

  const handleResizeDebounced = () => {
    if (debounceTimerRef) {
      clearTimeout(debounceTimerRef);
    }
    debounceTimerRef = setTimeout(() => {
      setState(calcBreakpointState(window.innerWidth));
      debounceTimerRef = null;
    }, RESIZE_DEBOUNCE_MS);
  };

  onMount(() => {
    const mdQuery = window.matchMedia(`(min-width: ${BP_MD}px)`);
    const lgQuery = window.matchMedia(`(min-width: ${BP_LG}px)`);

    mdQuery.addEventListener('change', handleChange);
    lgQuery.addEventListener('change', handleChange);
    window.addEventListener('resize', handleResizeDebounced);

    onCleanup(() => {
      mdQuery.removeEventListener('change', handleChange);
      lgQuery.removeEventListener('change', handleChange);
      window.removeEventListener('resize', handleResizeDebounced);
      if (debounceTimerRef) {
        clearTimeout(debounceTimerRef);
      }
    });
  });

  return state();
}
