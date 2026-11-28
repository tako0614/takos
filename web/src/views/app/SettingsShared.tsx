import type { JSX } from "solid-js";
export function Toggle(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class={`inline-flex min-h-[44px] min-w-[44px] md:min-h-0 flex-shrink-0 items-center justify-center rounded-full bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)] ${
        props.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <span
        aria-hidden="true"
        class={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors ${
          props.checked
            ? "bg-zinc-900 dark:bg-zinc-100"
            : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span
          class={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform dark:bg-zinc-900 ${
            props.checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

export function Section(props: {
  title: string;
  children: JSX.Element;
}) {
  return (
    <div class="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {props.title}
      </h2>
      {props.children}
    </div>
  );
}
