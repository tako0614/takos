import type { JSX } from "solid-js";

interface Props {
  children: JSX.Element;
  terminal?: boolean;
  class?: string;
}

/**
 * Generic syntax-highlighted-by-hand code block. We don't ship a
 * highlighter runtime; instead, callers wrap tokens in <span class="c|s|n|k">
 * inline. Keeps the bundle ~0 KB JS.
 */
export default function CodeBlock(props: Props) {
  const klass = () => {
    const parts = ["codeblock"];
    if (props.terminal) parts.push("code-terminal");
    if (props.class) parts.push(props.class);
    return parts.join(" ");
  };
  return (
    <div class={klass()}>
      <pre>{props.children}</pre>
    </div>
  );
}
