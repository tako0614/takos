import type { JSX } from "solid-js";

interface Props {
  size?: number;
  class?: string;
  title?: string;
}

/**
 * Layered product mark — three stacked rounded rectangles with a
 * subtle depth offset, suggesting `resources[]` snapping into the
 * apply pipeline. Single-color with the gradient applied as fill.
 *
 * Ported from takosumi dashboard-ui/src/components/brand/GeometricMark.tsx.
 */
export default function GeometricMark(props: Props): JSX.Element {
  const size = () => props.size ?? 48;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label={props.title ?? "Takosumi logo"}
      class={props.class}
    >
      <defs>
        <linearGradient
          id="tg-geo"
          x1="4"
          y1="4"
          x2="44"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="var(--tg-grad-from, #5d3afd)" />
          <stop offset="1" stop-color="var(--tg-grad-to, #00b1ff)" />
        </linearGradient>
      </defs>
      <rect
        x="6"
        y="6"
        width="30"
        height="10"
        rx="2.5"
        fill="url(#tg-geo)"
        opacity="0.55"
      />
      <rect
        x="9"
        y="19"
        width="30"
        height="10"
        rx="2.5"
        fill="url(#tg-geo)"
        opacity="0.78"
      />
      <rect x="12" y="32" width="30" height="10" rx="2.5" fill="url(#tg-geo)" />
    </svg>
  );
}
