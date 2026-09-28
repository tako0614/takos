import type { JSX } from 'solid-js';
import type { AppVisualKind } from '~/content/site';
import { useT } from '~/lib/i18n';

/** Real screenshots of the running takos app (public/screens), captured from
 *  the actual web UI — chat thread, agent Work board, memory list, and the
 *  install surface. Rendered as a plain figure: hairline border, honest
 *  caption, no re-drawn browser chrome. */
const FILES: Record<AppVisualKind, { src: string; w: number; h: number }> = {
  chat: { src: '/screens/chat.webp', w: 1600, h: 1000 },
  thread: { src: '/screens/chat-thread.webp', w: 1060, h: 1000 },
  agent: { src: '/screens/work.webp', w: 1600, h: 1000 },
  memory: { src: '/screens/memory.webp', w: 1600, h: 720 },
  space: { src: '/screens/install.webp', w: 1600, h: 500 },
};

export default function AppVisual(props: { kind: AppVisualKind }): JSX.Element {
  const t = useT();
  const copy = () => t.visuals[props.kind];
  return (
    <figure class='viz appviz-shot'>
      <img
        src={FILES[props.kind].src}
        alt={copy().alt}
        width={FILES[props.kind].w}
        height={FILES[props.kind].h}
      />
      <figcaption class='appviz-caption'>{copy().caption}</figcaption>
    </figure>
  );
}
