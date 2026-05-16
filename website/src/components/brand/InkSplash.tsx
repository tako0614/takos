import type { JSX } from "solid-js";

interface Props {
  variant?: 1 | 2 | 3;
  class?: string;
}

/**
 * Large organic ink-splash SVG used as a hero/section backdrop. Three
 * variants give visual variety without authoring a real sumi-e brush
 * stroke (which would feel like cultural costume). These are clean
 * vector blobs; the "ink" feel comes from gradient + scale + placement.
 */
export default function InkSplash(props: Props): JSX.Element {
  const v = () => props.variant ?? 1;
  return (
    <svg
      viewBox="0 0 600 600"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={props.class}
    >
      <defs>
        <radialGradient id={`ink-${v()}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--tg-grad-from)" stop-opacity="0.95" />
          <stop offset="55%" stop-color="var(--tg-grad-mid)" stop-opacity="0.7" />
          <stop offset="100%" stop-color="var(--tg-grad-to)" stop-opacity="0" />
        </radialGradient>
        <filter id={`ink-blur-${v()}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {v() === 1 && (
        <g filter={`url(#ink-blur-${v()})`}>
          <path
            d="M260 70 C 380 50, 500 160, 470 280 C 560 320, 540 460, 410 510 C 320 560, 210 530, 160 450 C 60 410, 70 290, 150 240 C 130 150, 190 80, 260 70 Z"
            fill={`url(#ink-${v()})`}
          />
          <circle cx="120" cy="180" r="22" fill={`url(#ink-${v()})`} opacity="0.7" />
          <circle cx="510" cy="430" r="14" fill={`url(#ink-${v()})`} opacity="0.6" />
          <circle cx="430" cy="100" r="9" fill={`url(#ink-${v()})`} opacity="0.5" />
        </g>
      )}
      {v() === 2 && (
        <g filter={`url(#ink-blur-${v()})`}>
          <path
            d="M120 380 C 30 320, 80 180, 200 170 C 280 60, 460 90, 490 220 C 590 240, 580 420, 470 470 C 360 540, 200 510, 170 430 C 130 425, 110 405, 120 380 Z"
            fill={`url(#ink-${v()})`}
          />
          <circle cx="80" cy="450" r="18" fill={`url(#ink-${v()})`} opacity="0.55" />
          <circle cx="540" cy="320" r="10" fill={`url(#ink-${v()})`} opacity="0.7" />
        </g>
      )}
      {v() === 3 && (
        <g filter={`url(#ink-blur-${v()})`}>
          <path
            d="M300 80 C 470 80, 520 220, 480 320 C 540 410, 460 540, 320 520 C 200 540, 110 470, 130 360 C 70 280, 130 130, 230 110 C 250 90, 280 80, 300 80 Z"
            fill={`url(#ink-${v()})`}
          />
          <circle cx="170" cy="200" r="14" fill={`url(#ink-${v()})`} opacity="0.6" />
          <circle cx="500" cy="140" r="8" fill={`url(#ink-${v()})`} opacity="0.55" />
          <circle cx="460" cy="500" r="20" fill={`url(#ink-${v()})`} opacity="0.5" />
        </g>
      )}
    </svg>
  );
}
