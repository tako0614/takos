import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
}

export function Select(props: SelectProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref && e.target instanceof Node && !ref.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() =>
      document.removeEventListener("mousedown", handleClickOutside)
    );
  });

  const selectedOption = () =>
    props.options.find((opt) => opt.value === props.value);

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
  ): JSX.CSSProperties => ({
    padding: "0.5rem 0.75rem",
    "font-size": "0.875rem",
    cursor: opt.disabled ? "not-allowed" : "pointer",
    "background-color": isSelected ? "var(--color-bg-tertiary)" : "transparent",
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
        type="button"
        style={triggerStyle()}
        onClick={() => !props.disabled && setIsOpen(!isOpen())}
        disabled={props.disabled}
      >
        <span>
          {selectedOption()?.label || props.placeholder || t("selectOption")}
        </span>
        <ChevronIcon isOpen={isOpen()} />
      </button>

      <Show when={isOpen()}>
        <div style={dropdownStyle}>
          <For each={props.options}>
            {(opt) => (
              <div
                style={optionStyle(opt, opt.value === props.value)}
                onClick={() => {
                  if (!opt.disabled) {
                    props.onChange?.(opt.value);
                    setIsOpen(false);
                  }
                }}
              >
                {opt.label}
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.error}>
        <p
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
      style={{
        transition: "transform 0.15s ease",
        transform: props.isOpen ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
