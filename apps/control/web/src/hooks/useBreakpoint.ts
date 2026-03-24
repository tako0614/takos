import { useState, useEffect, useRef, useCallback } from 'react';

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
  const [state, setState] = useState<BreakpointState>(() => {
    if (typeof window === 'undefined') {
      return { isMobile: false, isTablet: false, isDesktop: true, width: 1024 };
    }
    return calcBreakpointState(window.innerWidth);
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(() => {
    setState(calcBreakpointState(window.innerWidth));
  }, []);

  const handleResizeDebounced = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setState(calcBreakpointState(window.innerWidth));
      debounceTimerRef.current = null;
    }, RESIZE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    const mdQuery = window.matchMedia(`(min-width: ${BP_MD}px)`);
    const lgQuery = window.matchMedia(`(min-width: ${BP_LG}px)`);

    mdQuery.addEventListener('change', handleChange);
    lgQuery.addEventListener('change', handleChange);
    window.addEventListener('resize', handleResizeDebounced);

    return () => {
      mdQuery.removeEventListener('change', handleChange);
      lgQuery.removeEventListener('change', handleChange);
      window.removeEventListener('resize', handleResizeDebounced);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [handleChange, handleResizeDebounced]);

  return state;
}
