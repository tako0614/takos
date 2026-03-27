import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface ModalContextValue {
  showCreateSpace: boolean;
  setShowCreateSpace: (show: boolean) => void;
  showAgentModal: boolean;
  setShowAgentModal: (show: boolean) => void;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModals(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModals must be used within ModalProvider');
  }
  return context;
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const value = useMemo(
    (): ModalContextValue => ({
      showCreateSpace,
      setShowCreateSpace,
      showAgentModal,
      setShowAgentModal,
      showSearch,
      setShowSearch,
    }),
    [
      showCreateSpace,
      showAgentModal,
      showSearch,
    ],
  );

  return (
    <ModalContext.Provider value={value}>
      {children}
    </ModalContext.Provider>
  );
}
