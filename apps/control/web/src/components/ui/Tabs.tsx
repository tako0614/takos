import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from 'react';

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

interface TabsProps {
  defaultTab: string;
  children: ReactNode;
  onChange?: (tabId: string) => void;
}

export function Tabs({ defaultTab, children, onChange }: TabsProps) {
  const [activeTab, setActiveTabState] = useState(defaultTab);

  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    onChange?.(id);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabsContext.Provider>
  );
}

export function TabList({ children, className = '', style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: '0.25rem',
        borderBottom: '1px solid var(--color-border-primary)',
        ...style,
      }}
      role="tablist"
      {...props}
    >
      {children}
    </div>
  );
}

interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  id: string;
}

export function Tab({ id, children, className = '', style, ...props }: TabProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tab must be used within Tabs');

  const { activeTab, setActiveTab } = context;
  const isActive = activeTab === id;

  const tabStyle: CSSProperties = {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: `2px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    transition: 'var(--transition-colors)',
    marginBottom: '-1px',
  };

  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={className}
      style={{ ...tabStyle, ...style }}
      onClick={() => setActiveTab(id)}
      {...props}
    >
      {children}
    </button>
  );
}

interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
}

export function TabPanel({ id, children, className = '', style, ...props }: TabPanelProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabPanel must be used within Tabs');

  const { activeTab } = context;
  if (activeTab !== id) return null;

  return (
    <div
      role="tabpanel"
      className={className}
      style={{ padding: '1rem 0', ...style }}
      {...props}
    >
      {children}
    </div>
  );
}
