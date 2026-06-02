import { For, type JSX } from 'solid-js';
import type { Rich } from '~/content/site';

/**
 * Renders an inline rich-text segment array. `code` segments become <code>,
 * `em` segments get the accent emphasis. Kept data-driven (no innerHTML) so it
 * stays CSP-safe under `script-src 'self'`.
 */
export default function RichText(props: { value: Rich }): JSX.Element {
  return (
    <For each={props.value}>
      {(seg) =>
        seg.code ? <code>{seg.t}</code> : seg.em ? <em class='em'>{seg.t}</em> : <>{seg.t}</>}
    </For>
  );
}
