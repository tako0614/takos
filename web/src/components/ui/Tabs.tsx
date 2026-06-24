import {
  createContext,
  createSignal,
  createUniqueId,
  Show,
  splitProps,
  useContext,
} from "solid-js";
import type { JSX } from "solid-js";
import { moveTabFocus } from "../../lib/a11y.ts";

interface TabsContextValue {
  activeTab: () => string;
  setActiveTab: (id: string) => void;
  // Per-group prefix so tab/panel DOM ids stay unique when several Tabs
  // instances render on the same page.
  groupId: string;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

/** DOM id of a tab button, derived from the group + logical tab id. */
function tabDomId(groupId: string, id: string): string {
  return `${groupId}-tab-${id}`;
}

/** DOM id of a tab panel, derived from the group + logical tab id. */
function panelDomId(groupId: string, id: string): string {
  return `${groupId}-panel-${id}`;
}

interface TabsProps {
  defaultTab: string;
  children: JSX.Element;
  onChange?: (tabId: string) => void;
}

export function Tabs(props: TabsProps) {
  const [activeTab, setActiveTabState] = createSignal(props.defaultTab);
  const groupId = createUniqueId();

  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    props.onChange?.(id);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab, groupId }}>
      {props.children}
    </TabsContext.Provider>
  );
}

interface TabListProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function TabList(props: TabListProps) {
  const [local, rest] = splitProps(props, ["children", "class", "style"]);

  return (
    <div
      class={local.class ?? ""}
      style={{
        display: "flex",
        gap: "0.25rem",
        // Scroll rather than clip/wrap when tabs overflow a narrow viewport.
        "overflow-x": "auto",
        "border-bottom": "1px solid var(--color-border-primary)",
        ...(typeof local.style === "object" && local.style !== null
          ? local.style
          : {}),
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
  const [local, rest] = splitProps(props, ["id", "children", "class", "style"]);

  const context = useContext(TabsContext);
  if (!context) throw new Error("Tab must be used within Tabs");

  const { activeTab, setActiveTab, groupId } = context;

  // Arrow / Home / End keyboard navigation across the tablist (automatic
  // activation: the selected panel follows focus).
  const handleKeyDown = (e: KeyboardEvent) => {
    const nextId = moveTabFocus(e);
    if (nextId) setActiveTab(nextId);
  };

  const tabStyle = (): JSX.CSSProperties => ({
    padding: "0.75rem 1rem",
    "font-size": "0.875rem",
    "font-weight": 500,
    "background-color": "transparent",
    border: "none",
    "border-bottom": `2px solid ${
      activeTab() === local.id ? "var(--color-primary)" : "transparent"
    }`,
    color: activeTab() === local.id
      ? "var(--color-text-primary)"
      : "var(--color-text-secondary)",
    cursor: "pointer",
    transition: "var(--transition-colors)",
    "margin-bottom": "-1px",
  });

  return (
    <button
      type="button"
      role="tab"
      id={tabDomId(groupId, local.id)}
      data-tab-id={local.id}
      aria-selected={activeTab() === local.id}
      aria-controls={panelDomId(groupId, local.id)}
      tabindex={activeTab() === local.id ? 0 : -1}
      class={local.class ?? ""}
      style={{
        ...tabStyle(),
        ...(typeof local.style === "object" && local.style !== null
          ? local.style
          : {}),
      }}
      onClick={() => setActiveTab(local.id)}
      onKeyDown={handleKeyDown}
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
  const [local, rest] = splitProps(props, ["id", "children", "class", "style"]);

  const context = useContext(TabsContext);
  if (!context) throw new Error("TabPanel must be used within Tabs");

  const { activeTab, groupId } = context;

  return (
    <Show when={activeTab() === local.id}>
      <div
        role="tabpanel"
        id={panelDomId(groupId, local.id)}
        aria-labelledby={tabDomId(groupId, local.id)}
        tabindex={0}
        class={local.class ?? ""}
        style={{
          padding: "1rem 0",
          ...(typeof local.style === "object" && local.style !== null
            ? local.style
            : {}),
        }}
        {...rest}
      >
        {local.children}
      </div>
    </Show>
  );
}
