import { For, type JSX } from 'solid-js';

/** White pixel squares drifting on the field — the tako's water, made
 *  visible. Pure CSS animation; positions/sizes are hand-placed, not a
 *  uniform scatter, so the field feels inhabited rather than textured. */
const BUBBLES: readonly { x: string; y: string; s: number; d: string; dl: string; o: number }[] = [
  { x: '4%',  y: '22%', s: 12, d: '5.2s', dl: '0s',    o: 0.5 },
  { x: '11%', y: '64%', s: 8,  d: '6.1s', dl: '1.2s',  o: 0.4 },
  { x: '18%', y: '40%', s: 16, d: '4.4s', dl: '0.6s',  o: 0.55 },
  { x: '26%', y: '80%', s: 8,  d: '5.8s', dl: '2.1s',  o: 0.35 },
  { x: '38%', y: '14%', s: 8,  d: '6.6s', dl: '0.9s',  o: 0.45 },
  { x: '47%', y: '58%', s: 12, d: '5.0s', dl: '1.7s',  o: 0.4 },
  { x: '58%', y: '30%', s: 8,  d: '6.3s', dl: '0.3s',  o: 0.5 },
  { x: '66%', y: '72%', s: 14, d: '4.8s', dl: '2.6s',  o: 0.45 },
  { x: '74%', y: '18%', s: 10, d: '5.5s', dl: '1.1s',  o: 0.55 },
  { x: '82%', y: '52%', s: 8,  d: '6.9s', dl: '0.4s',  o: 0.4 },
  { x: '90%', y: '34%', s: 14, d: '5.1s', dl: '1.9s',  o: 0.5 },
  { x: '95%', y: '70%', s: 8,  d: '6.0s', dl: '0.8s',  o: 0.35 },
];

export default function Bubbles(): JSX.Element {
  return (
    <div class='bubbles' aria-hidden='true'>
      <For each={BUBBLES}>
        {(b) => (
          <i
            style={{
              left: b.x,
              top: b.y,
              width: b.s + 'px',
              height: b.s + 'px',
              opacity: b.o,
              'animation-duration': b.d,
              'animation-delay': b.dl,
            }}
          />
        )}
      </For>
    </div>
  );
}
