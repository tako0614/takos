import { atom } from 'jotai/vanilla';
import type { RouteState } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Route state atoms (driven by useRouter, synced via hook)
// ---------------------------------------------------------------------------

export const routeAtom = atom<RouteState>({ view: 'home' });

/**
 * Write-only atom storing the `navigate` callback from useRouter.
 * Populated by `useNavigationSync`.
 */
export const navigateFnAtom = atom<(state: Partial<RouteState>) => void>(() => {});

/**
 * Write-only atom storing the `replace` callback from useRouter.
 * Populated by `useNavigationSync`.
 */
export const replaceFnAtom = atom<(state: RouteState) => void>(() => {});
