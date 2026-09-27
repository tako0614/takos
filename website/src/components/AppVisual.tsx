import type { JSX } from 'solid-js';
import type { AppVisualKind } from '~/content/site';
import { useT } from '~/lib/i18n';

/** Real screenshots of the running takos app (public/screens), captured from
 *  the actual web UI — chat thread, agent Work board, memory list, and the
 *  install surface. Rendered as a plain figure: hairline border, honest
 *  caption, no re-drawn browser chrome. */
const FILES: Record<AppVisualKind, string> = {
  chat: '/screens/chat.webp',
  agent: '/screens/work.webp',
  memory: '/screens/memory.webp',
  space: '/screens/install.webp',
};

export default function AppVisual(props: { kind: AppVisualKind }): JSX.Element {
  const t = useT();
  const copy = () => t.visuals[props.kind];
  return (
    <figure class='viz appviz-shot'>
      <img
        src={FILES[props.kind]}
        alt={copy().alt}
        width='1600'
        height='1000'
        loading='lazy'
      />
      <figcaption class='appviz-caption'>{copy().caption}</figcaption>
    </figure>
  );
}
