/**
 * Bilingual content dictionary for the Takos landing site.
 *
 * `ja` is the source-of-truth voice (Takos is JP-first); `en` mirrors it for
 * discoverability. Both locales are prerendered as separate routes (`/` and
 * `/en/`). Keep product nouns (chat / agent / memory / space, bundled apps,
 * Takosumi, Installation) identical across locales — only the connective prose
 * is translated. Do NOT describe Takosumi concepts as Takos features, and do
 * not soften the managed-offering launch gate (see AGENTS.md 中核原則).
 */

export type Locale = 'ja' | 'en';
export const LOCALES: readonly Locale[] = ['ja', 'en'];

/** Inline rich-text segment. `code` renders <code>, `em` renders the accent. */
export interface Seg {
  readonly t: string;
  readonly code?: boolean;
  readonly em?: boolean;
}
export type Rich = readonly Seg[];

export interface TitleLine {
  readonly t: string;
  readonly grad?: boolean;
}

export interface Item {
  readonly title: string;
  readonly body: string;
}

export interface AppItem {
  readonly name: string;
  readonly tag: string;
  readonly body: string;
}

export interface Stat {
  readonly num: string;
  readonly label: string;
  readonly note: string;
}

export interface CompareRow {
  readonly label: string;
  readonly us: string;
  readonly them: string;
}

export interface InstallCard {
  readonly kind: 'use' | 'git' | 'self';
  readonly title: string;
  readonly body: string;
  readonly cta?: string;
}

export interface Strings {
  readonly htmlLang: string;
  readonly meta: {
    readonly title: string;
    readonly description: string;
    readonly ogTitle: string;
    readonly ogDescription: string;
  };
  readonly nav: {
    readonly why: string;
    readonly features: string;
    readonly apps: string;
    readonly docs: string;
    readonly install: string;
    readonly openMenu: string;
    readonly closeMenu: string;
  };
  readonly hero: {
    readonly eyebrow: string;
    readonly title: readonly TitleLine[];
    readonly lede: Rich;
    readonly useTakos: string;
    readonly gitInstall: string;
    readonly scroll: string;
    readonly termComment1: string;
    readonly termComment2: string;
    readonly termOk1: string;
    readonly termOk2: string;
    readonly copy: string;
    readonly copied: string;
  };
  readonly why: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: Rich;
    readonly points: readonly Item[];
  };
  readonly pillars: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly items: readonly Item[];
  };
  readonly features: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly items: readonly Item[];
  };
  readonly apps: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly items: readonly AppItem[];
  };
  readonly stats: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly Stat[];
  };
  readonly compare: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly colUs: string;
    readonly colThem: string;
    readonly rows: readonly CompareRow[];
  };
  readonly install: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: Rich;
    readonly cards: readonly InstallCard[];
  };
  readonly footer: {
    readonly tagline: string;
    readonly copyright: string;
    readonly links: readonly { readonly label: string; readonly href: string; readonly external?: boolean; readonly cloud?: boolean }[];
  };
}

const ja: Strings = {
  htmlLang: 'ja',
  meta: {
    title: 'Takos — AI と話す場所は、あなたのサーバーで。',
    description:
      'Takos は self-hostable な AI-first chat & agent product。chat / agent / memory / space を core に持ち、docs / slide / excel / computer / social などの bundled apps が新規 space 作成時に auto-install される。Takosumi 上で動くので Cloudflare / AWS / GCP / 自前 VM どこにでも install でき、history も memory も自分のサーバーの外に出ない。AGPL の OSS。',
    ogTitle: 'Takos — AI-first chat & agent, your own server.',
    ogDescription:
      'self-hostable な AI chat & agent。history も memory も自分のサーバーの中。1-click で Takosumi に install、自前 substrate では Git source から install。AGPL の OSS。',
  },
  nav: {
    why: 'なぜ Takos',
    features: '特徴',
    apps: 'Bundled apps',
    docs: 'Docs',
    install: 'Install',
    openMenu: 'メニューを開く',
    closeMenu: 'メニューを閉じる',
  },
  hero: {
    eyebrow: '墨 · OPEN SOURCE · AI-FIRST',
    title: [
      { t: 'AI agent' },
      { t: 'for me', grad: true },
    ],
    lede: [
      { t: '自分のための AI agent。chat / agent / memory / space を、' },
      { t: '自分のサーバーの中で', em: true },
      { t: '。ログインしてすぐ始められます。' },
    ],
    useTakos: 'Takos を使う',
    gitInstall: 'Git から install',
    scroll: 'scroll',
    termComment1: '# どこにでも install できるが、一番速いのは Use Takos。',
    termComment2: '# 自前 substrate では Git source を install lifecycle に渡す:',
    termOk1: '✓ takos-worker → http://your-takos.example/',
    termOk2: '✓ takos-git → docs / files / agents',
    copy: 'コピー',
    copied: 'コピーしました',
  },
  why: {
    eyebrow: 'why takos',
    title: 'ソフトウェアを、自分の手に。',
    lede: [
      { t: 'AI は日常のインフラになりつつある。だからこそ、' },
      { t: '誰と話したか・何を覚えさせたか', em: true },
      { t: ' が他社のサーバーに溜まり続けるのは、おかしい。Takos は chat も agent も memory も、' },
      { t: 'あなたが所有するサーバーの中で', em: true },
      { t: ' 完結させます。' },
    ],
    points: [
      {
        title: 'データ主権',
        body: '会話・memory・file はすべて自分の VM / cloud の中。ベンダーに預けず、いつでも export・移行できる。',
      },
      {
        title: 'ロックインしない',
        body: 'SaaS lock-in も vendor lock-in も無し。Cloudflare / AWS / GCP / K8s / 自前 VM、同じ Takos がどこでも動く。',
      },
      {
        title: 'fork できる自由',
        body: 'AGPL でコードは全部 public。自分仕様に fork して、機能を足しても、外しても、あなたの自由。',
      },
    ],
  },
  pillars: {
    eyebrow: 'core',
    title: '4 つの core で、AI を日常に。',
    lede: 'Takos product が提供するのは chat / agent / memory / space。この 4 つが噛み合って、AI とのやり取りがあなたの作業空間に積み上がる。',
    items: [
      { title: 'Chat', body: 'LLM との会話を、thread として space に整理。複数モデルを切り替えながら使える。' },
      { title: 'Agent', body: 'tool を呼び、file を触り、長い手順を回す agent。Rust 製の agent engine が実行を担う。' },
      { title: 'Memory', body: 'やり取りから memory が space に積み上がる。次の会話に文脈が引き継がれ、データは外に出ない。' },
      { title: 'Space', body: '人・agent・app・data の単位。space ごとに分離され、bundled app が auto-install される。' },
    ],
  },
  features: {
    eyebrow: 'features',
    title: '所有しながら、繋がる。',
    lede: '自分のサーバーで完結しつつ、必要なところでは fediverse とも繋がる。Takos が大事にしているのはこの両立。',
    items: [
      {
        title: 'プライバシー by default',
        body: 'history も memory も file も、自分のサーバーの中。第三者に渡らないのが既定の挙動。',
      },
      {
        title: 'Bundled apps が auto-install',
        body: 'takos-docs / slide / excel / computer / yurucommu が新規 space 作成と同時に揃う。不要なら uninstall。',
      },
      {
        title: 'Federation で繋がる',
        body: 'ActivityPub 経由で他の Takos や fediverse と connection。サイロ化しないが、data は自分の中。',
      },
      {
        title: 'どんな substrate でも',
        body: '個人の small VM から enterprise の K8s cluster まで、同じ Takos が動く。スケールに応じて選べる。',
      },
      {
        title: 'Takosumi 上で動く',
        body: 'install / deploy は OpenTofu-native な Takosumi が担当。plan を確認してから apply できる。',
      },
      {
        title: 'OSS / forkable',
        body: 'AGPL。コードは全部 public で、fork してあなた仕様にできる。contributor も歓迎。',
      },
    ],
  },
  apps: {
    eyebrow: 'bundled apps',
    title: '新規 space で、すぐ揃う。',
    lede: 'Takos distribution と一緒に ship される 1st-party の InstallableApp。新規 space 作成と同時に install 済みで、必要なければ uninstall できる。',
    items: [
      {
        name: 'takos-docs',
        tag: 'docs',
        body: 'ノート + ドキュメント。Tiptap ベースのリッチテキストエディタで、agent からの編集にも対応していく。',
      },
      {
        name: 'takos-slide',
        tag: 'slides',
        body: 'プレゼン作成。keynote / Google Slides の代替を、自分の space の中で。',
      },
      {
        name: 'takos-excel',
        tag: 'sheet',
        body: 'スプレッドシート。calc + formula 対応で、data を space に閉じたまま扱える。',
      },
      {
        name: 'takos-computer',
        tag: 'agent-tool',
        body: 'agent から呼び出せる computer use 環境。手順の自動化を agent に任せられる。',
      },
      {
        name: 'yurucommu',
        tag: 'social',
        body: 'self-hosted な ActivityPub / community social。fediverse に繋がる独立 product。',
      },
    ],
  },
  stats: {
    eyebrow: 'by the numbers',
    title: '足し算ではなく、所有。',
    items: [
      { num: '4', label: 'core', note: 'chat · agent · memory · space' },
      { num: '5', label: 'bundled apps', note: 'docs · slide · excel · computer · social' },
      { num: 'AGPL', label: 'license', note: 'コードは全部 public · forkable' },
      { num: '5', label: 'substrates', note: 'Cloudflare · AWS · GCP · K8s · VM' },
    ],
  },
  compare: {
    eyebrow: 'why self-host',
    title: '預けるか、所有するか。',
    lede: '自分のサーバーで動かす Takos と、提供元に預ける SaaS chat の典型的な違い。data が誰のものか、という観点で並べています (すべての SaaS に当てはまるわけではありません)。',
    colUs: 'Takos (self-host)',
    colThem: 'SaaS chat (預ける)',
    rows: [
      { label: 'data の所在', us: '自分の VM / cloud', them: 'ベンダーのサーバー' },
      { label: 'memory / 履歴', us: '自分の space に保持', them: '提供元が保持・学習に利用しうる' },
      { label: 'ベンダーロックイン', us: 'いつでも export・移行', them: '移行は困難なことが多い' },
      { label: 'カスタマイズ', us: 'AGPL で fork 自由', them: '提供される範囲のみ' },
      { label: 'Federation', us: 'ActivityPub で接続', them: '基本クローズド' },
      { label: '料金 (self-host)', us: 'ソフトは無料 (基盤費のみ)', them: 'seat / 従量課金' },
    ],
  },
  install: {
    eyebrow: 'install',
    title: '始めるのは、ボタン 1 つから。',
    lede: [
      { t: 'むずかしい設定はいりません。リンクを押すと ' },
      { t: 'Takosumi', code: true },
      { t: ' の導入画面が開き、中身を確認してから自分の場所に入れて、そのまま使えます。だれでも同じ入口です。' },
    ],
    cards: [
      {
        kind: 'use',
        title: 'すぐ使う',
        body: 'いちばん簡単な入口。ログインして、画面の案内にそって進むだけで Takos を始められます。一般公開の準備が整うまでは、案内の途中でいったん止まります。',
        cta: 'すぐ使う',
      },
      {
        kind: 'git',
        title: 'リンクから入れる',
        body: 'ボタンを押すと導入画面が開き、入れるアプリと入れる先が分かりやすく表示されます。中身を確認してそのまま導入。エンジニアでなくてもここから始められます（取得元の細かい設定は折りたたみの中にあります）。',
        cta: 'リンクから入れる',
      },
      {
        kind: 'self',
        title: '自分のサーバーで動かす',
        body: '自分のインフラで動かしたい人向け。同じ Git の取得元を、自前の Takosumi に CLI から入れられます。クラウドの種類などは自分で選べます。',
      },
    ],
  },
  footer: {
    tagline: 'AI と話す場所は、あなたのサーバーで。',
    copyright: '© Takos contributors — AGPL · Powered by Takosumi.',
    links: [
      { label: 'Docs', href: 'https://docs.takos.jp/', external: true },
      { label: 'GitHub', href: 'https://github.com/tako0614/takos', external: true },
      { label: 'Takosumi', href: 'https://takosumi.com/', external: true },
      { label: 'Cloud', href: '#cloud', cloud: true },
    ],
  },
};

const en: Strings = {
  htmlLang: 'en',
  meta: {
    title: 'Takos — AI-first chat & agent, on your own server.',
    description:
      'Takos is a self-hostable, AI-first chat & agent product. Its core is chat / agent / memory / space, and bundled apps like docs / slide / excel / computer / social auto-install with every new space. It runs on Takosumi, so you can install it on Cloudflare, AWS, GCP, or your own VM — and your history and memory never leave your server. Open source under AGPL.',
    ogTitle: 'Takos — AI-first chat & agent, your own server.',
    ogDescription:
      'A self-hostable AI chat & agent. Your history and memory stay on your own server. One-click install on Takosumi, or install from a Git source on your own substrate. Open source, AGPL.',
  },
  nav: {
    why: 'Why Takos',
    features: 'Features',
    apps: 'Bundled apps',
    docs: 'Docs',
    install: 'Install',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },
  hero: {
    eyebrow: '墨 · OPEN SOURCE · AI-FIRST',
    title: [
      { t: 'AI agent' },
      { t: 'for me', grad: true },
    ],
    lede: [
      { t: 'Your own AI agent — chat, agent, memory, and space, ' },
      { t: 'on a server you own', em: true },
      { t: '. Log in and start in seconds.' },
    ],
    useTakos: 'Use Takos',
    gitInstall: 'Install from Git',
    scroll: 'scroll',
    termComment1: '# You can install it anywhere, but Use Takos is the fastest.',
    termComment2: '# On your own substrate, hand a Git source to the install lifecycle:',
    termOk1: '✓ takos-worker → http://your-takos.example/',
    termOk2: '✓ takos-git → docs / files / agents',
    copy: 'Copy',
    copied: 'Copied',
  },
  why: {
    eyebrow: 'why takos',
    title: 'Own your software.',
    lede: [
      { t: 'AI is becoming everyday infrastructure. So it is strange that ' },
      { t: 'who you talked to and what you taught it', em: true },
      { t: ' keeps piling up on someone else’s server. Takos keeps chat, agent, and memory ' },
      { t: 'inside a server you own', em: true },
      { t: '.' },
    ],
    points: [
      {
        title: 'Data sovereignty',
        body: 'Conversations, memory, and files all live inside your own VM or cloud. Nothing is entrusted to a vendor, and you can export or migrate anytime.',
      },
      {
        title: 'No lock-in',
        body: 'No SaaS lock-in, no vendor lock-in. The same Takos runs on Cloudflare, AWS, GCP, Kubernetes, or your own VM.',
      },
      {
        title: 'Freedom to fork',
        body: 'AGPL, with all code public. Fork it to fit you — add features, remove them, make it yours.',
      },
    ],
  },
  pillars: {
    eyebrow: 'core',
    title: 'Four core ideas bring AI into daily work.',
    lede: 'The Takos product gives you chat / agent / memory / space. The four mesh together so your interactions with AI accumulate inside your own workspace.',
    items: [
      { title: 'Chat', body: 'Conversations with LLMs, organized as threads inside a space. Switch between multiple models as you go.' },
      { title: 'Agent', body: 'Agents that call tools, touch files, and run long procedures — executed by a Rust agent engine.' },
      { title: 'Memory', body: 'Memory accumulates in your space from your interactions; context carries into the next chat, and data stays in.' },
      { title: 'Space', body: 'The unit of people, agents, apps, and data. Each space is isolated, and bundled apps auto-install into it.' },
    ],
  },
  features: {
    eyebrow: 'features',
    title: 'Own it, yet stay connected.',
    lede: 'Self-contained on your own server, yet connected to the fediverse where it matters. Takos cares about having both.',
    items: [
      {
        title: 'Privacy by default',
        body: 'History, memory, and files stay inside your own server. Not sharing them with third parties is the default behavior.',
      },
      {
        title: 'Bundled apps auto-install',
        body: 'takos-docs / slide / excel / computer / yurucommu arrive the moment you create a space. Uninstall any you don’t need.',
      },
      {
        title: 'Connected by federation',
        body: 'Connect to other Takos instances and the fediverse via ActivityPub. No silos — but your data stays with you.',
      },
      {
        title: 'Any substrate',
        body: 'From a personal small VM to an enterprise Kubernetes cluster, the same Takos runs. Choose by your scale.',
      },
      {
        title: 'Runs on Takosumi',
        body: 'Install and deploy are handled by the OpenTofu-native Takosumi. Review the plan before you apply.',
      },
      {
        title: 'Open source / forkable',
        body: 'AGPL. All code is public — fork it to make it yours. Contributors welcome.',
      },
    ],
  },
  apps: {
    eyebrow: 'bundled apps',
    title: 'Ready the moment you start.',
    lede: 'First-party InstallableApps shipped with the Takos distribution. Included with every new space, and removable if you don’t need them.',
    items: [
      {
        name: 'takos-docs',
        tag: 'docs',
        body: 'Notes and documents. A Tiptap-based rich-text editor, growing toward agent-driven editing.',
      },
      {
        name: 'takos-slide',
        tag: 'slides',
        body: 'Build presentations. A Keynote / Google Slides alternative, inside your own space.',
      },
      {
        name: 'takos-excel',
        tag: 'sheet',
        body: 'Spreadsheets with calc and formulas, keeping your data inside your space.',
      },
      {
        name: 'takos-computer',
        tag: 'agent-tool',
        body: 'A computer-use environment your agents can call to automate multi-step work.',
      },
      {
        name: 'yurucommu',
        tag: 'social',
        body: 'Self-hosted ActivityPub / community social — an independent product that connects to the fediverse.',
      },
    ],
  },
  stats: {
    eyebrow: 'by the numbers',
    title: 'Not more features — ownership.',
    items: [
      { num: '4', label: 'core', note: 'chat · agent · memory · space' },
      { num: '5', label: 'bundled apps', note: 'docs · slide · excel · computer · social' },
      { num: 'AGPL', label: 'license', note: 'all code public · forkable' },
      { num: '5', label: 'substrates', note: 'Cloudflare · AWS · GCP · K8s · VM' },
    ],
  },
  compare: {
    eyebrow: 'why self-host',
    title: 'Entrust it, or own it.',
    lede: 'How running Takos on your own server differs from delegating to a SaaS provider — typical trade-offs framed around who owns the data (not true of every product).',
    colUs: 'Takos (self-host)',
    colThem: 'SaaS chat (delegated)',
    rows: [
      { label: 'Where data lives', us: 'Your own VM / cloud', them: 'The vendor’s servers' },
      { label: 'Memory / history', us: 'Kept in your space', them: 'Held by the provider, may train on it' },
      { label: 'Vendor lock-in', us: 'Export / migrate anytime', them: 'Migration is often hard' },
      { label: 'Customization', us: 'Fork freely under AGPL', them: 'Only what is offered' },
      { label: 'Federation', us: 'Connected via ActivityPub', them: 'Mostly closed' },
      { label: 'Price (self-host)', us: 'Software is free (infra only)', them: 'Per-seat / usage billing' },
    ],
  },
  install: {
    eyebrow: 'install',
    title: 'It starts with one button.',
    lede: [
      { t: 'No tricky setup. Press the link and ' },
      { t: 'Takosumi', code: true },
      { t: "'s install screen opens — review what's inside, add it to your own place, and start using it. Same entrance for everyone." },
    ],
    cards: [
      {
        kind: 'use',
        title: 'Just use it',
        body: 'The easiest way in. Log in and follow the on-screen guide to start Takos. Until the public launch is ready, the guide pauses partway through.',
        cta: 'Just use it',
      },
      {
        kind: 'git',
        title: 'Install from a link',
        body: 'The button opens the install screen showing, in plain terms, the app you are adding and where it goes. Review it and install. You do not need to be an engineer to start here (the finer source settings live inside a fold-out).',
        cta: 'Install from a link',
      },
      {
        kind: 'self',
        title: 'Run it on your own server',
        body: 'For people who want to run it on their own infrastructure. Install the same Git source onto your own Takosumi from the CLI. You choose the cloud and the rest yourself.',
      },
    ],
  },
  footer: {
    tagline: 'The place you talk to AI is your own server.',
    copyright: '© Takos contributors — AGPL · Powered by Takosumi.',
    links: [
      { label: 'Docs', href: 'https://docs.takos.jp/', external: true },
      { label: 'GitHub', href: 'https://github.com/tako0614/takos', external: true },
      { label: 'Takosumi', href: 'https://takosumi.com/', external: true },
      { label: 'Cloud', href: '#cloud', cloud: true },
    ],
  },
};

export const SITE: Record<Locale, Strings> = { ja, en };
