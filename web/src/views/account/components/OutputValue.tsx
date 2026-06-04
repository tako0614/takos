import { Show } from "solid-js";

/**
 * Renders a DeploymentOutput value — a clickable link for http(s) strings,
 * a `<code>` block otherwise.
 * Ported from
 * takosumi dashboard-ui/src/components/apps/installation-detail/OutputValue.tsx.
 */
export default function OutputValue(props: { readonly value: unknown }) {
  const value = () => props.value;
  return (
    <Show
      when={typeof value() === "string" ? (value() as string) : undefined}
      fallback={<code>{JSON.stringify(value())}</code>}
    >
      {(text) => (
        <Show
          when={text().startsWith("https://") || text().startsWith("http://")}
          fallback={<code>{text()}</code>}
        >
          <a href={text()}>{text()}</a>
        </Show>
      )}
    </Show>
  );
}
