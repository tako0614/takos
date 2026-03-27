import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, type ReactNode } from 'react';

export const mobileHeaderContentAtom = atom<ReactNode>(null);

export function useMobileHeader() {
  const headerContent = useAtomValue(mobileHeaderContentAtom);
  const setHeaderContent = useSetAtom(mobileHeaderContentAtom);
  return { headerContent, setHeaderContent };
}

/** ビューがアンマウント時に自動クリアするヘルパーフック */
export function useMobileHeaderContent(content: ReactNode) {
  const setHeaderContent = useSetAtom(mobileHeaderContentAtom);
  useEffect(() => {
    setHeaderContent(content);
    return () => setHeaderContent(null);
  }, []);
}
