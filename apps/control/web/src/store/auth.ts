import { atom } from 'jotai';
import type { User, UserSettings, Space } from '../types';

export type AuthState = 'loading' | 'login' | 'authenticated';

export type FetchSpacesOptions = {
  notifyOnError?: boolean;
  throwOnError?: boolean;
};

export const authStateAtom = atom<AuthState>('loading');
export const userAtom = atom<User | null>(null);
export const userSettingsAtom = atom<UserSettings | null>(null);
export const spacesAtom = atom<Space[]>([]);
export const spacesLoadedAtom = atom<boolean>(false);

export function redirectToLogin(returnTo?: string): void {
  const url = new URL('/auth/login', window.location.origin);
  if (returnTo) {
    url.searchParams.set('return_to', returnTo);
  }
  window.location.href = url.toString();
}
