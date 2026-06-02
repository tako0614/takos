import { createSignal, For } from 'solid-js';
import CodeBlock from './CodeBlock';
import SplatField from './SplatField';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';
import RichText from './RichText';
import { copyText, useParallax } from '~/lib/interactions';

const INSTALL_CMD =
  'bunx @takosjp/takosumi install dry-run --source git:https://github.com/you/takos#main --space my-space';

export default function Hero() {
  const t = useT();
  const cloud = useCloudUrls();
  let splashRef: HTMLDivElement | undefined;
  const [copied, setCopied] = createSignal(false);

  useParallax(() => splashRef, 0.16);

  const onCopy = async () => {
    if (await copyText(INSTALL_CMD)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <section class='hero'>
      <div ref={splashRef} class='hero-splat-wrap' aria-hidden='true'>
        <SplatField density='hero' />
      </div>
      <div class='container hero-grid'>
        <div class='hero-copy'>
          <span class='eyebrow'>{t.hero.eyebrow}</span>
          <h1>
            <For each={t.hero.title}>
              {(line) => <span class='hero-line' classList={{ 'grad-text': line.grad }}>{line.t}</span>}
            </For>
          </h1>
          <p class='lede'>
            <RichText value={t.hero.lede} />
          </p>
          <div class='cta-row'>
            <a class='btn btn-primary' href={cloud().useTakos} rel='noopener'>
              {t.hero.useTakos} →
            </a>
            <a class='btn btn-secondary' href={cloud().install} rel='noopener'>
              {t.hero.gitInstall}
            </a>
          </div>
        </div>
        <div class='hero-terminal'>
          <CodeBlock terminal>
            <button type='button' class='code-copy' onClick={onCopy} aria-label={copied() ? t.hero.copied : t.hero.copy}>
              {copied() ? t.hero.copied : t.hero.copy}
            </button>
            <span class='c'>{t.hero.termComment1}</span>
            {'\n'}
            <span class='k'>$</span> open https://accounts.takosumi.com/dashboard/use-takos{'\n'}
            <span class='k'>$</span>&nbsp;&nbsp;&nbsp;→ Account / Space / launch{'\n'}
            <span class='c'>{t.hero.termComment2}</span>
            {'\n'}
            <span class='k'>$</span> bunx @takosjp/takosumi install dry-run \{'\n'}
            <span class='k'>$</span>&nbsp;&nbsp;--source git:https://github.com/you/takos#main --space my-space{'\n'}
            <span class='c'>{t.hero.termOk1}</span>
            {'\n'}
            <span class='c'>{t.hero.termOk2}</span>
          </CodeBlock>
        </div>
      </div>
      <a class='hero-scroll' href='#why' aria-label={t.hero.scroll}>
        {t.hero.scroll}
        <svg
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
          stroke-linecap='round'
          stroke-linejoin='round'
          aria-hidden='true'
        >
          <path d='M6 9l6 6 6-6' />
        </svg>
      </a>
    </section>
  );
}
