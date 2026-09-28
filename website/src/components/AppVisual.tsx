import type { JSX } from 'solid-js';
import type { AppVisualKind } from '~/content/site';
import { useT } from '~/lib/i18n';

/** Real screenshots of the running takos app (public/screens), captured from
 *  the actual web UI and cropped to the region that carries the content —
 *  dead window space is cut, nothing is redrawn. Rendered as a plain figure:
 *  hairline image rule, honest caption, no re-drawn chrome. */
const FILES: Record<AppVisualKind, { src: string; w: number; h: number }> = {
  chat: { src: '/screens/chat-stitch.webp', w: 1600, h: 810 },
  thread: { src: '/screens/thread-stitch.webp', w: 1060, h: 580 },
  work: { src: '/screens/work-tasks.webp', w: 1140, h: 400 },
  memory: { src: '/screens/memory-cards.webp', w: 1600, h: 470 },
  install: { src: '/screens/install.webp', w: 1600, h: 500 },
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

