import { atom } from 'jotai';
import type { Space } from '../types';

// ---------------------------------------------------------------------------
// Sidebar atoms
// ---------------------------------------------------------------------------

export const sidebarSpaceAtom = atom<Space | null>(null);
export const showMobileNavDrawerAtom = atom<boolean>(false);
export const mobileNavDrawerId = 'mobile-navigation-drawer';
