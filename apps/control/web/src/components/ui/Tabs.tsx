import { createContext, useContext, createSignal, splitProps, Show } from 'solid-js';
import type { JSX } from 'solid-js';

interface TabsContextValue {
  activeTab: () => string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

interface TabsProps {
  defaultTab: string;
  children: JSX.Element;
  onChange?: (tabId: string) => void;
}

export function Tabs(props: TabsProps) {
  const [activeTab, setActiveTabState] = createSignal(props.defaultTab);

  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    props.onChange?.(id);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      {props.children}
    </TabsContext.Provider>
  );
}

interface TabListProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function TabList(props: TabListProps) {
  const [local, rest] = splitProps(props, ['children', 'class', 'style']);

  return (
    <div
      class={local.class ?? ''}
      style={{
        display: 'flex',
        gap: '0.25rem',
        'border-bottom': '1px solid var(--color-border-primary)',
        ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
      }}
      role="tablist"
      {...rest}
    >
      {local.children}
    </div>
  );
}

interface TabProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  id: string;
}

export function Tab(props: TabProps) {
  const [local, rest] = splitProps(props, ['id', 'children', 'class', 'style']);

  const context = useContext(TabsContext);
  if (!context) throw new Error('Tab must be used within Tabs');

  const { activeTab, setActiveTab } = context;

  const tabStyle = (): JSX.CSSProperties => ({
    padding: '0.75rem 1rem',
    'font-size': '0.875rem',
    'font-weight': 500,
    'background-color': 'transparent',
    border: 'none',
    'border-bottom': `2px solid ${activeTab() === local.id ? 'var(--color-primary)' : 'transparent'}`,
    color: activeTab() === local.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    transition: 'var(--transition-colors)',
    'margin-bottom': '-1px',
  });

  return (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab() === local.id}
      class={local.class ?? ''}
      style={{
        ...tabStyle(),
        ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
      }}
      onClick={() => setActiveTab(local.id)}
      {...rest}
    >
      {local.children}
    </button>
  );
}

interface TabPanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
  id: string;
}

export function TabPanel(props: TabPanelProps) {
  const [local, rest] = splitProps(props, ['id', 'children', 'class', 'style']);

  const context = useContext(TabsContext);
  if (!context) throw new Error('TabPanel must be used within Tabs');

  const { activeTab } = context;

  return (
    <Show when={activeTab() === local.id}>
      <div
        role="tabpanel"
        class={local.class ?? ''}
        style={{
          padding: '1rem 0',
          ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
        }}
        {...rest}
      >
        {local.children}
      </div>
    </Show>
  );
}
