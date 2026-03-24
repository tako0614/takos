import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface MobileHeaderContextValue {
  headerContent: ReactNode;
  setHeaderContent: (content: ReactNode) => void;
}

const MobileHeaderContext = createContext<MobileHeaderContextValue>({
  headerContent: null,
  setHeaderContent: () => {},
});

export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [headerContent, setHeaderContent] = useState<ReactNode>(null);
  return (
    <MobileHeaderContext.Provider value={{ headerContent, setHeaderContent }}>
      {children}
    </MobileHeaderContext.Provider>
  );
}

export function useMobileHeader() {
  return useContext(MobileHeaderContext);
}

/** ビューがアンマウント時に自動クリアするヘルパーフック */
export function useMobileHeaderContent(content: ReactNode) {
  const { setHeaderContent } = useMobileHeader();
  useEffect(() => {
    setHeaderContent(content);
    return () => setHeaderContent(null);
  }, []);
}
