import CodeBlock from './CodeBlock';
import InkSplash from './brand/InkSplash';
import { createSignal, onMount } from 'solid-js';
import { resolveCloudUrls } from '~/lib/cloud-url';

export default function Hero() {
  const [cloudUrls, setCloudUrls] = createSignal(resolveCloudUrls(''));
  onMount(() => setCloudUrls(resolveCloudUrls()));

  return (
    <section class='hero'>
      <InkSplash class='hero-splash' variant={1} />
      <div class='container hero-grid'>
        <div class='hero-copy'>
          <span class='eyebrow'>墨 · open source · AI-first</span>
          <h1>
            <span class='hero-line'>AI と話す場所は、</span>
            <span class='hero-line grad-text'>あなたの</span>
            <span class='hero-line'>サーバーで。</span>
          </h1>
          <p class='lede'>
            Chat / agent / memory / space を core に持つ、 self-hostable な AI chat product。 <code>takos-docs</code> や
            {' '}
            <code>yurucommu</code>{' '}
            なんかの bundled apps は新規 space 作成と同時に auto-install される。 history も memory も自分の VM
            の外に出ない。
          </p>
          <div class='cta-row'>
            <a
              class='btn btn-primary'
              href={cloudUrls().useTakos}
              rel='noopener'
            >
              Use Takos →
            </a>
            <a
              class='btn btn-secondary'
              href={cloudUrls().install}
              rel='noopener'
            >
              Git から install
            </a>
          </div>
        </div>
        <div class='hero-terminal'>
          <CodeBlock terminal>
            <span class='c'>
              # どこにでも install できるが、 一番速いのは Use Takos。
            </span>
            {'\n'}
            <span class='k'>$</span> open https://accounts.takosumi.com/dashboard/use-takos{'\n'}
            <span class='k'>$</span>&nbsp;&nbsp;&nbsp;→ Account / Space / launch{'\n'}
            <span class='c'>
              # 自前 substrate では Git source を install lifecycle に渡す:
            </span>
            {'\n'}
            <span class='k'>$</span> bun x @takosjp/takosumi install dry-run \{'\n'}
            <span class='k'>$</span>&nbsp;&nbsp;--source git:https://github.com/you/takos#main --space my-space{'\n'}
            <span class='c'>✓ takos-worker → http://your-takos.example/</span>
            {'\n'}
            <span class='c'>✓ takos-git → docs / files / agents</span>
          </CodeBlock>
        </div>
      </div>
      <div class='hero-scroll' aria-hidden='true'>
        scroll
        <svg
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
          stroke-linecap='round'
          stroke-linejoin='round'
        >
          <path d='M6 9l6 6 6-6' />
        </svg>
      </div>
    </section>
  );
}
