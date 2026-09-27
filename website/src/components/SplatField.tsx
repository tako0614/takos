import { For, type JSX } from 'solid-js';
import InkSplash from './brand/InkSplash';

/**
 * Decorative ink layer — the "octopus ink" brand gesture. One deliberate
 * composition per surface, not wallpaper: a large blob bleeding off an edge
 * plus one or two small splats. Deterministic (no Math.random / Date), so it
 * is static-prerender safe. Pure decoration: aria-hidden, pointer-events:none,
 * sits under content via .splat-field { z-index:0 }.
 *
 * `density='hero'` = the hero composition (large, bleeds off the right edge).
 * `density='section'` = a faint echo for section corners. Page-wide scatter
 * was removed — see takos-control/docs/reference/design-language.md.
 */

interface Splat {
  readonly top?: string;
  readonly left?: string;
  readonly right?: string;
  readonly bottom?: string;
  readonly size: number;
  readonly rotate: number;
  readonly color: 'blue' | 'red';
  readonly variant: 1 | 2 | 3 | 4 | 5;
  readonly opacity: number;
}

const HERO: readonly Splat[] = [
  // One big red gesture bleeding off the top-right behind the product shot,
  // a smaller blue answer at the bottom-left of the copy, and one stray
  // droplet — an intentional cluster, not a scatter.
  { top: '-14%', right: '-12%', size: 620, rotate: 14, color: 'red', variant: 2, opacity: 0.5 },
  { bottom: '6%', left: '-8%', size: 300, rotate: -30, color: 'blue', variant: 4, opacity: 0.34 },
  { top: '18%', left: '34%', size: 120, rotate: 55, color: 'blue', variant: 5, opacity: 0.3 },
];

const SECTION: readonly Splat[] = [
  { top: '-50px', right: '3%', size: 250, rotate: 24, color: 'blue', variant: 2, opacity: 0.22 },
  { bottom: '-40px', left: '5%', size: 220, rotate: -30, color: 'red', variant: 5, opacity: 0.2 },
];

function styleFor(s: Splat): string {
  const pos = [
    s.top != null ? `top:${s.top}` : '',
    s.left != null ? `left:${s.left}` : '',
    s.right != null ? `right:${s.right}` : '',
    s.bottom != null ? `bottom:${s.bottom}` : '',
  ].filter(Boolean).join(';');
  return `position:absolute;${pos};width:${s.size}px;height:${s.size}px;opacity:${s.opacity};transform:rotate(${s.rotate}deg)`;
}

export default function SplatField(props: { density?: 'hero' | 'section'; class?: string }): JSX.Element {
  const splats = () => (props.density === 'hero' ? HERO : SECTION);
  return (
    <div class={`splat-field ${props.class ?? ''}`} aria-hidden='true'>
      <For each={splats()}>
        {(s) => (
          <span class='splat' style={styleFor(s)}>
            <InkSplash color={s.color} variant={s.variant} />
          </span>
        )}
      </For>
    </div>
  );
}
