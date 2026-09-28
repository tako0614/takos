import { type JSX, Show } from 'solid-js';

interface Props {
  id?: string;
  /** Margin number rendered left of the body (document clause numbering). */
  index?: string;
  title?: string;
  lede?: JSX.Element;
  class?: string;
  children: JSX.Element;
}

export default function Section(props: Props): JSX.Element {
  return (
    <section id={props.id} class={props.class}>
      <div class='container doc-grid'>
        <span class='doc-index' aria-hidden='true'>
          {props.index}
        </span>
        <div class='doc-body'>
          <Show when={props.title}>
            <h2>{props.title}</h2>
          </Show>
          <Show when={props.lede}>
            <p class='lede'>{props.lede}</p>
          </Show>
          {props.children}
        </div>
      </div>
    </section>
  );
}

