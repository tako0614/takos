import {
  createContext,
  createSignal,
  type ParentComponent,
  useContext,
} from "solid-js";

export interface ModalContextValue {
  showCreateSpace: boolean;
  setShowCreateSpace: (show: boolean) => void;
  showAgentModal: boolean;
  setShowAgentModal: (show: boolean) => void;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
}

const ModalContext = createContext<ModalContextValue>();

export const ModalProvider: ParentComponent = (props) => {
  const [showCreateSpace, setShowCreateSpace] = createSignal(false);
  const [showAgentModal, setShowAgentModal] = createSignal(false);
  const [showSearch, setShowSearch] = createSignal(false);

  const value: ModalContextValue = {
    get showCreateSpace() {
      return showCreateSpace();
    },
    setShowCreateSpace,
    get showAgentModal() {
      return showAgentModal();
    },
    setShowAgentModal,
    get showSearch() {
      return showSearch();
    },
    setShowSearch,
  };

  return (
    <ModalContext.Provider value={value}>
      {props.children}
    </ModalContext.Provider>
  );
};

export function useModals(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModals must be used within a ModalProvider");
  }
  return context;
}
