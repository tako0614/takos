import {
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../store/i18n.ts";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  error?: string;
  class?: string;
  style?: JSX.CSSProperties;
  "aria-label"?: string;
}

export function Select(props: SelectProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  let ref: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

  const listboxId = createUniqueId();
  const errorId = createUniqueId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref && e.target instanceof Node && !ref.contains(e.target)) {
        close();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (typeaheadTimer) clearTimeout(typeaheadTimer);
    });
  });

  const selectedIndex = () =>
    props.options.findIndex((opt) => opt.value === props.value);
  const selectedOption = () => props.options[selectedIndex()];

  const firstEnabledFrom = (start: number, dir: 1 | -1): number => {
    const n = props.options.length;
    if (n === 0) return -1;
    let i = ((start % n) + n) % n;
    for (let step = 0; step < n; step++) {
      if (!props.options[i]?.disabled) return i;
      i = ((i + dir) % n + n) % n;
    }
    return -1;
  };

  const open = () => {
    if (props.disabled || isOpen()) return;
    setIsOpen(true);
    const sel = selectedIndex();
    setActiveIndex(sel >= 0 ? sel : firstEnabledFrom(0, 1));
  };

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const commit = (index: number) => {
    const opt = props.options[index];
    if (!opt || opt.disabled) return;
    props.onChange?.(opt.value);
    close();
    triggerRef?.focus();
  };

  const move = (dir: 1 | -1) => {
    if (!isOpen()) {
      open();
      return;
    }
    const current = activeIndex();
    const start = current < 0 ? (dir === 1 ? -1 : 0) : current;
    setActiveIndex(firstEnabledFrom(start + dir, dir));
  };

  const onTypeahead = (char: string) => {
    typeahead += char.toLowerCase();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => (typeahead = ""), 600);
    const match = props.options.findIndex(
      (opt) => !opt.disabled && opt.label.toLowerCase().startsWith(typeahead),
    );
    if (match >= 0) {
      if (!isOpen()) open();
      setActiveIndex(match);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        if (isOpen()) {
          e.preventDefault();
          setActiveIndex(firstEnabledFrom(0, 1));
        }
        break;
      case "End":
        if (isOpen()) {
          e.preventDefault();
          setActiveIndex(firstEnabledFrom(props.options.length - 1, -1));
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen() && activeIndex() >= 0) commit(activeIndex());
        else open();
        break;
      case "Escape":
        if (isOpen()) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          onTypeahead(e.key);
        }
    }
  };

  const triggerStyle = (): JSX.CSSProperties => ({
    width: "100%",
    padding: "0.5rem 0.75rem",
    "font-size": "0.875rem",
    "background-color": "var(--color-surface-primary)",
    color: selectedOption()
      ? "var(--color-text-primary)"
      : "var(--color-text-tertiary)",
    border: `1px solid ${
      props.error ? "var(--color-error)" : "var(--color-border-primary)"
    }`,
    "border-radius": "var(--radius-md)",
    cursor: props.disabled ? "not-allowed" : "pointer",
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    opacity: props.disabled ? "0.5" : "1",
    transition: "var(--transition-colors)",
  });

  const dropdownStyle: JSX.CSSProperties = {
    position: "absolute",
    top: "100%",
    left: "0",
    right: "0",
    "margin-top": "0.25rem",
    "background-color": "var(--color-surface-elevated)",
    border: "1px solid var(--color-border-primary)",
    "border-radius": "var(--radius-md)",
    "box-shadow": "var(--shadow-lg)",
    "z-index": "50",
    "max-height": "15rem",
    "overflow-y": "auto",
  };

  const optionStyle = (
    opt: SelectOption,
    isSelected: boolean,
    isActive: boolean,
  ): JSX.CSSProperties => ({
    padding: "0.5rem 0.75rem",
    "font-size": "0.875rem",
    cursor: opt.disabled ? "not-allowed" : "pointer",
    "background-color": isActive
      ? "var(--color-bg-tertiary)"
      : isSelected
      ? "var(--color-surface-secondary)"
      : "transparent",
    color: opt.disabled
      ? "var(--color-text-tertiary)"
      : "var(--color-text-primary)",
    opacity: opt.disabled ? "0.5" : "1",
    transition: "var(--transition-colors)",
  });

  return (
    <div
      ref={ref}
      class={props.class}
      style={{ position: "relative", ...props.style }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
        aria-controls={listboxId}
        aria-activedescendant={isOpen() && activeIndex() >= 0
          ? optionId(activeIndex())
          : undefined}
        aria-label={props["aria-label"]}
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? errorId : undefined}
        style={triggerStyle()}
        onClick={() => !props.disabled && (isOpen() ? close() : open())}
        onKeyDown={handleKeyDown}
        disabled={props.disabled}
      >
        <span>
          {selectedOption()?.label || props.placeholder || t("selectOption")}
        </span>
        <ChevronIcon isOpen={isOpen()} />
      </button>

      <Show when={isOpen()}>
        <div role="listbox" id={listboxId} style={dropdownStyle}>
          <For each={props.options}>
            {(opt, index) => (
              <div
                id={optionId(index())}
                role="option"
                aria-selected={opt.value === props.value}
                aria-disabled={opt.disabled ? "true" : undefined}
                style={optionStyle(
                  opt,
                  opt.value === props.value,
                  index() === activeIndex(),
                )}
                onClick={() => commit(index())}
                onMouseEnter={() => !opt.disabled && setActiveIndex(index())}
              >
                {opt.label}
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.error}>
        <p
          id={errorId}
          role="alert"
          style={{
            "margin-top": "0.25rem",
            "font-size": "0.75rem",
            color: "var(--color-error)",
          }}
        >
          {props.error}
        </p>
      </Show>
    </div>
  );
}

function ChevronIcon(props: { isOpen: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
      style={{
        transition: "transform 0.15s ease",
        transform: props.isOpen ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
