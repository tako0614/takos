import type { JSX } from 'solid-js';
import type { AppVisualKind } from '~/content/site';
import { useT } from '~/lib/i18n';

/** Real screenshots of the running takos app (public/screens), captured from
 *  the actual web UI and cropped to the region that carries the content.
 *  Rendered plain — full width, full brightness, a 1px rule to separate it
 *  from the page, no frame chrome and no caption. */
const FILES: Record<AppVisualKind, { src: string; w: number; h: number }> = {
  chat: { src: '/screens/chat-stitch.webp', w: 1600, h: 810 },
  thread: { src: '/screens/thread-stitch.webp', w: 1060, h: 580 },
  work: { src: '/screens/work-tasks.webp', w: 1140, h: 400 },
  memory: { src: '/screens/memory-cards.webp', w: 1600, h: 470 },
  install: { src: '/screens/install.webp', w: 1600, h: 500 },
};

export default function AppVisual(props: { kind: AppVisualKind }): JSX.Element {
  const t = useT();
  const f = () => FILES[props.kind];
  return (
    <img
      class='shot'
      src={f().src}
      alt={t.visuals[props.kind].alt}
      width={f().w}
      height={f().h}
      loading='lazy'
      decoding='async'
    />
  );
}
