import { type JSX, Show } from 'solid-js';

interface Props {
  id?: string;
  title?: string;
  lede?: JSX.Element;
  class?: string;
  children: JSX.Element;
}

export default function Section(props: Props): JSX.Element {
  return (
    <section id={props.id} class={props.class}>
      <div class='container'>
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
