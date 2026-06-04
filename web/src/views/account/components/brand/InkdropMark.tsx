import type { JSX } from "solid-js";

interface Props {
  size?: number;
  class?: string;
  title?: string;
}

/**
 * Inkdrop mark — a single ink droplet (墨) with a subtle inner spiral
 * (a wink at the "tako" without going literal). Fill uses the brand
 * gradient; inner spiral uses currentColor so it reads in any
 * theme.
 *
 * Ported from takosumi dashboard-ui/src/components/brand/InkdropMark.tsx.
 */
export default function InkdropMark(props: Props): JSX.Element {
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
          id="tg-ink"
          x1="24"
          y1="4"
          x2="24"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="var(--tg-grad-from, #5d3afd)" />
          <stop offset="1" stop-color="var(--tg-grad-to, #00b1ff)" />
        </linearGradient>
      </defs>
      {/* droplet body — classic teardrop curve, point at top */}
      <path
        d="M24 4 C18 16, 8 22, 8 31 C8 39, 15 44, 24 44 C33 44, 40 39, 40 31 C40 22, 30 16, 24 4 Z"
        fill="url(#tg-ink)"
      />
      {/* inner spiral — currentColor so it inverts in dark mode */}
      <path
        d="M30 30 a6 6 0 1 1 -10 -3 a4 4 0 1 1 7 1.5"
        stroke="var(--tg-bg, #fdfdfd)"
        stroke-width="1.6"
        stroke-linecap="round"
        fill="none"
        opacity="0.92"
      />
    </svg>
  );
}
