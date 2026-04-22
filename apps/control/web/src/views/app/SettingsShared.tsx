import type { JSX } from "solid-js";
export function Toggle(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
        props.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
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
