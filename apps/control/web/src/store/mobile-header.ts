import { atom } from 'jotai/vanilla';
import { useAtomValue, useSetAtom } from 'solid-jotai';
import { onMount, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';

export const mobileHeaderContentAtom = atom<JSX.Element | null>(null);

export function useMobileHeader() {
  const headerContent = useAtomValue(mobileHeaderContentAtom);
  const setHeaderContent = useSetAtom(mobileHeaderContentAtom);
  return { get headerContent() { return headerContent(); }, setHeaderContent };
}

/** ビューがアンマウント時に自動クリアするヘルパーフック */
export function useMobileHeaderContent(content: JSX.Element | null) {
  const setHeaderContent = useSetAtom(mobileHeaderContentAtom);
  onMount(() => setHeaderContent(content));
  onCleanup(() => setHeaderContent(null));
}
