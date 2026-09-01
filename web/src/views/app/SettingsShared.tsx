import type { JSX } from "solid-js";
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
