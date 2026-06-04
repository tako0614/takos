import type { JSX } from "solid-js";
import GeometricMark from "./GeometricMark.tsx";

interface Props {
  size?: number;
  href?: string;
  showSub?: boolean;
  class?: string;
}

/**
 * Takosumi wordmark — geometric mark + word + 'Cloud' subtitle.
 * Ported from takosumi dashboard-ui/src/components/brand/Wordmark.tsx.
 */
export default function Wordmark(props: Props): JSX.Element {
  const inner = (
    <>
      <GeometricMark size={props.size ?? 26} />
      <span class="wordmark-text">
        Takosumi
        {props.showSub !== false && (
          <span class="wordmark-sub" style="margin-left:6px">Cloud</span>
        )}
      </span>
    </>
  );
  return props.href === undefined
    ? <span class={`wordmark ${props.class ?? ""}`}>{inner}</span>
    : (
      <a
        href={props.href}
        class={`wordmark ${props.class ?? ""}`}
        aria-label="Takosumi home"
      >
        {inner}
      </a>
    );
}
