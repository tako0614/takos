import { For, type JSX } from 'solid-js';
import InkSplash from './brand/InkSplash';

/**
 * Decorative ink-splatter layer. Renders a hand-tuned (deterministic — no
 * Math.random / Date, so it is static-prerender safe) scattered set of crisp
 * <InkSplash> in blue + red across its container. Pure decoration: aria-hidden,
 * pointer-events:none, sits under content via .splat-field { z-index:0 }.
 *
 * `density='hero'` = larger, denser, higher opacity (some bleeding off-edge).
 * `density='section'` = smaller, sparser, low opacity near corners/edges so it
 * never hurts body-text contrast. Same blue/red balance on both sites.
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
  { top: '-70px', right: '-90px', size: 540, rotate: 18, color: 'blue', variant: 1, opacity: 0.62 },
  { top: '6%', left: '-100px', size: 440, rotate: -22, color: 'red', variant: 2, opacity: 0.58 },
  { bottom: '-90px', left: '8%', size: 380, rotate: 40, color: 'blue', variant: 5, opacity: 0.52 },
  { bottom: '2%', right: '5%', size: 340, rotate: -12, color: 'red', variant: 3, opacity: 0.56 },
  { top: '38%', right: '15%', size: 240, rotate: 60, color: 'blue', variant: 4, opacity: 0.46 },
  { top: '22%', left: '22%', size: 210, rotate: -40, color: 'red', variant: 5, opacity: 0.44 },
  { bottom: '28%', left: '-50px', size: 280, rotate: 10, color: 'red', variant: 1, opacity: 0.5 },
  { top: '-40px', left: '32%', size: 210, rotate: 120, color: 'blue', variant: 3, opacity: 0.44 },
];

const SECTION: readonly Splat[] = [
  { top: '-50px', right: '3%', size: 250, rotate: 24, color: 'blue', variant: 2, opacity: 0.34 },
  { bottom: '-40px', left: '5%', size: 220, rotate: -30, color: 'red', variant: 5, opacity: 0.3 },
  { top: '26%', left: '-70px', size: 200, rotate: 50, color: 'red', variant: 3, opacity: 0.3 },
];

const PAGE: readonly Splat[] = [
  { top: '1%', right: '-90px', size: 280, rotate: 16, color: 'blue', variant: 1, opacity: 0.3 },
  { top: '5%', left: '-100px', size: 300, rotate: -24, color: 'red', variant: 2, opacity: 0.28 },
  { top: '10%', right: '4%', size: 210, rotate: 52, color: 'red', variant: 4, opacity: 0.24 },
  { top: '15%', left: '2%', size: 240, rotate: -38, color: 'blue', variant: 5, opacity: 0.28 },
  { top: '21%', right: '-110px', size: 290, rotate: 12, color: 'blue', variant: 3, opacity: 0.3 },
  { top: '26%', left: '-80px', size: 220, rotate: 44, color: 'red', variant: 1, opacity: 0.26 },
  { top: '32%', right: '3%', size: 250, rotate: -16, color: 'red', variant: 5, opacity: 0.28 },
  { top: '37%', left: '-110px', size: 300, rotate: 28, color: 'blue', variant: 2, opacity: 0.26 },
  { top: '43%', right: '-90px', size: 220, rotate: -48, color: 'blue', variant: 4, opacity: 0.28 },
  { top: '49%', left: '4%', size: 260, rotate: 20, color: 'red', variant: 3, opacity: 0.3 },
  { top: '54%', right: '-100px', size: 230, rotate: -28, color: 'red', variant: 2, opacity: 0.26 },
  { top: '60%', left: '-90px', size: 260, rotate: 56, color: 'blue', variant: 1, opacity: 0.28 },
  { top: '65%', right: '3%', size: 290, rotate: -14, color: 'blue', variant: 5, opacity: 0.3 },
  { top: '71%', left: '-100px', size: 220, rotate: 36, color: 'red', variant: 4, opacity: 0.26 },
  { top: '77%', right: '-90px', size: 250, rotate: -40, color: 'red', variant: 1, opacity: 0.28 },
  { top: '82%', left: '2%', size: 270, rotate: 22, color: 'blue', variant: 3, opacity: 0.28 },
  { top: '88%', right: '-110px', size: 230, rotate: -20, color: 'blue', variant: 2, opacity: 0.26 },
  { top: '93%', left: '-80px', size: 280, rotate: 30, color: 'red', variant: 5, opacity: 0.28 },
  { top: '98%', right: '4%', size: 240, rotate: -34, color: 'red', variant: 4, opacity: 0.26 },
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

export default function SplatField(props: { density?: 'hero' | 'section' | 'page'; class?: string }): JSX.Element {
  const splats = () => (props.density === 'hero' ? HERO : props.density === 'page' ? PAGE : SECTION);
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
