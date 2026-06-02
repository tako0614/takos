import { type JSX, Show } from 'solid-js';
import SplatField from './SplatField';

interface Props {
  id?: string;
  eyebrow?: string;
  title?: string;
  lede?: JSX.Element;
  class?: string;
  /** Render a decorative ink-splatter layer behind this section's content. */
  splat?: boolean;
  children: JSX.Element;
}

/**
 * Standard section scaffold: optional eyebrow + h2 + lede, then content, all
 * inside the shared `.container`. Keeps section markup DRY across the page.
 */
export default function Section(props: Props): JSX.Element {
  return (
    <section id={props.id} class={props.class}>
      <Show when={props.splat}>
        <SplatField density='section' />
      </Show>
      <div class='container'>
        <Show when={props.eyebrow}>
          <span class='eyebrow'>{props.eyebrow}</span>
        </Show>
        <Show when={props.title}>
          <h2>{props.title}</h2>
        </Show>
        <Show when={props.lede}>
          <p class='lede'>{props.lede}</p>
        </Show>
        {props.children}
      </div>
    </section>
  );
}
