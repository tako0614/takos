/**
 * Bilingual content dictionary for the Takos site.
 *
 * The page is the workspace, annotated. Real UI screenshots run to the
 * viewport edge — no frames, no card chrome — and short captions sit in
 * the margin like someone pointing at the screen. The hero carries mono
 * labels pinned to the regions they name; the tour below uses the UI's
 * own region names (chat / Work board / memory), not marketing titles.
 * No numbered feature steps, no repeated h2 chrome, no centered-column
 * monotony — the earlier "document column of sections" still read as a
 * generated LP template.
 *
 * 'ja' is the source-of-truth voice (Takos is JP-first); 'en' mirrors it.
 * Keep product nouns (chat / agent / memory / Workspace, installable apps,
 * Takosumi) identical across locales — do not translate them into weaker
 * Japanese. Do NOT describe Takosumi concepts as Takos features, and do not
 * soften the platform-readiness launch gate (see AGENTS.md 中核原則).
 */

export type Locale = "ja" | "en";
export const LOCALES: readonly Locale[] = ["ja", "en"];

/** Inline rich-text segment. 'code' renders <code>, 'em' renders the accent. */
export interface Seg {
  readonly t: string;
  readonly code?: boolean;
  readonly em?: boolean;
}
export type Rich = readonly Seg[];

/** Which real screen the AppVisual component renders (public/screens). */
export type AppVisualKind = "chat" | "thread" | "work" | "memory";

/** A mono label pinned to a region of the hero screenshot. x/y are
 *  percentages of the image box. */
export interface HeroLabel {
  readonly t: string;
  readonly x: number;
  readonly y: number;
}

/** One tour station — a real UI region, its own name, and one short
 *  caption. 'key' selects the screenshot AppVisual renders. */
export interface Station {
  readonly key: AppVisualKind;
  readonly eyebrow: string;
  readonly name: string;
  readonly body: string;
}

export interface AppItem {
  readonly name: string;
  readonly body: string;
}

export interface InstallCard {
  readonly kind: "use" | "git" | "self";
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
    readonly workspace: string;
    readonly apps: string;
    readonly data: string;
    readonly install: string;
    readonly docs: string;
    readonly openMenu: string;
    readonly closeMenu: string;
  };
  readonly head: {
    readonly desc: Rich;
    readonly facts: string;
    readonly useTakos: string;
    readonly github: string;
    readonly docs: string;
  };
  readonly hero: {
    readonly caption: string;
    readonly labels: readonly HeroLabel[];
  };
  readonly stations: readonly Station[];
  readonly apps: {
    readonly title: string;
    readonly lede: string;
    readonly items: readonly AppItem[];
  };
  readonly data: {
    readonly title: string;
    readonly points: readonly string[];
  };
  readonly install: {
    readonly title: string;
    readonly lede: Rich;
    readonly cards: readonly InstallCard[];
  };
  readonly visuals: Record<AppVisualKind, { readonly alt: string }>;
  readonly footer: {
    readonly copyright: string;
    readonly links: readonly {
      readonly label: string;
      readonly href: string;
      readonly external?: boolean;
      readonly cloud?: boolean;
    }[];
  };
}

const ja: Strings = {
  htmlLang: "ja",
  meta: {
    title: "Takos",
    description:
      "Takos は self-hostable な chat & agent product。chat で依頼すると agent が tool を呼んで仕事を進め、成果物は file、やり取りは memory として自分のサーバー内の Workspace に残る。office / computer / social などの installable apps を Capsule として追加でき、OpenTofu module で self-host できる AGPL-3.0 の OSS。",
    ogTitle: "Takos",
    ogDescription:
      "Self-hosted chat & agent workspace。chat で依頼すると agent が tool を呼んで仕事を進め、成果物と memory は自分のサーバー内の Workspace に残る。AGPL-3.0 · OpenTofu module。",
  },
  nav: {
    workspace: "画面",
    apps: "Apps",
    data: "データ",
    install: "導入",
    docs: "Docs",
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
  },
  head: {
    desc: [
      { t: "self-hostable な chat & agent product。chat で依頼すると agent が tool を呼んで仕事を進め、成果物は file、やり取りは memory として Workspace に残る。データは全部、自分のサーバーの中。" },
    ],
    facts:
      "AGPL-3.0 · github.com/tako0614/takos · takos-agent-engine (Rust) · Cloudflare adapter (OpenTofu)",
    useTakos: "使う",
    github: "GitHub",
    docs: "Docs",
  },
  hero: {
    caption:
      "実際の Workspace の画面。見えているものは全部、自分のサーバーの中にある。",
    labels: [
      { t: "workspace", x: 41, y: 4 },
      { t: "run", x: 63, y: 7.5 },
      { t: "chat", x: 55, y: 88 },
      { t: "スレッド", x: 9.5, y: 52 },
      { t: "memory", x: 15.5, y: 17 },
    ],
  },
  stations: [
    {
      key: "thread",
      eyebrow: "chat",
      name: "頼む",
      body: "やりたいことをそのまま書く。cloud の LLM も local model も同じスレッドで切り替え、agent がその場で tool を呼ぶ。",
    },
    {
      key: "work",
      eyebrow: "Work board",
      name: "進む",
      body: "job は task として board に載り、状態で追える。tool 呼び出しと複数ステップの実行は Rust 製の takos-agent-engine が担う。",
    },
    {
      key: "memory",
      eyebrow: "memory",
      name: "残る",
      body: "成果物は file、やり取りは memory として Workspace に蓄積する。次の会話はここの続きから始まる。",
    },
  ],
  apps: {
    title: "Installable apps",
    lede:
      "Apps 画面の「Add from Git URL」から Capsule を install すると、Workspace に tile が並び、その app が公開する tool が MCP 経由で agent の toolbox に加わる。",
    items: [
      {
        name: "takos-office",
        body: "docs / slide / sheet を 1 つの worker に統合した office suite。agent が MCP 経由で file を直接編集できる。",
      },
      {
        name: "takos-computer",
        body: "agent から呼べる computer use 環境。ブラウザ操作やコマンド実行を任せられる。",
      },
      {
        name: "yurucommu",
        body: "self-hosted ActivityPub social。fediverse に繋がる独立 product で、Capsule として追加できる。",
      },
    ],
  },
  data: {
    title: "データ",
    points: [
      "会話・memory・file は自分のサーバー内の Workspace に保存される",
      "いつでも丸ごと export して別の環境へ移せる",
      "実行基盤は Cloudflare adapter (OpenTofu module)。別の基盤は adapter を追加できる",
      "ActivityPub で他の Takos・fediverse と接続する",
    ],
  },
  install: {
    title: "導入",
    lede: [
      { t: "リンクを押すと " },
      { t: "Takosumi", code: true },
      { t: " の導入画面が開く。中身を確認して自分の場所に入れ、そのまま使える。" },
    ],
    cards: [
      {
        kind: "use",
        title: "すぐ使う",
        body: "ログインして案内にそって進むだけ。一般公開の準備が整うまでは、案内の途中でいったん止まる。",
        cta: "使う",
      },
      {
        kind: "git",
        title: "Capsule として入れる",
        body: "Takosumi の導入画面に、入れる app と入れる先が表示される。内容を確認してそのまま導入できる。",
        cta: "install 画面を開く",
      },
      {
        kind: "self",
        title: "自分のサーバーで動かす",
        body: "release tag を固定し、依存を入れ、OpenTofu の plan を確認してから apply する。",
      },
    ],
  },
  visuals: {
    chat: {
      alt: "Takos の実画面: chat での依頼に agent が tool を実行し、docs にファイルを保存して返答している",
    },
    thread: {
      alt: "Takos の実画面: chat スレッドで agent が tool 実行の結果を返している",
    },
    work: {
      alt: "Takos の実画面: Work Tasks に予定・進行中・完了の task が並んでいる",
    },
    memory: {
      alt: "Takos の実画面: memory 一覧にエピソード・知識・手順のカードが並んでいる",
    },
  },
  footer: {
    copyright: "© Takos contributors — AGPL · Powered by Takosumi.",
    links: [
      { label: "Docs", href: "https://docs.takos.jp/", external: true },
      {
        label: "GitHub",
        href: "https://github.com/tako0614/takos",
        external: true,
      },
      { label: "Takosumi", href: "https://takosumi.com/", external: true },
      { label: "Cloud", href: "#cloud", cloud: true },
    ],
  },
};

const en: Strings = {
  htmlLang: "en",
  meta: {
    title: "Takos",
    description:
      "Takos is a self-hostable chat & agent product. Ask in chat and the agent calls tools to get the work done; artifacts stay as files and the exchange accrues as memory inside the Workspace on your own server. Installable apps (office / computer / social) attach as Capsules. OpenTofu module, AGPL-3.0.",
    ogTitle: "Takos",
    ogDescription:
      "Self-hosted chat & agent workspace. Ask in chat and the agent runs the tools; artifacts and memory stay in the Workspace on your own server. AGPL-3.0 · OpenTofu module.",
  },
  nav: {
    workspace: "Screens",
    apps: "Apps",
    data: "Data",
    install: "Install",
    docs: "Docs",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  head: {
    desc: [
      {
        t: "A self-hostable chat & agent product. Ask in chat and the agent calls tools to get the work done; artifacts stay as files and the exchange accrues as memory inside the Workspace. All of it on your own server.",
      },
    ],
    facts:
      "AGPL-3.0 · github.com/tako0614/takos · takos-agent-engine (Rust) · Cloudflare adapter (OpenTofu)",
    useTakos: "Use it",
    github: "GitHub",
    docs: "Docs",
  },
  hero: {
    caption:
      "The actual Workspace screen. Everything visible lives inside your own server.",
    labels: [
      { t: "workspace", x: 41, y: 4 },
      { t: "run", x: 63, y: 7.5 },
      { t: "chat", x: 55, y: 88 },
      { t: "threads", x: 9.5, y: 52 },
      { t: "memory", x: 15.5, y: 17 },
    ],
  },
  stations: [
    {
      key: "thread",
      eyebrow: "chat",
      name: "Ask",
      body: "Write what you want in plain words. Cloud LLMs and local models switch inside the same thread, and the agent calls tools on the spot.",
    },
    {
      key: "work",
      eyebrow: "Work board",
      name: "Track",
      body: "The job lands on the board as a task and is tracked by state. Tool calls and multi-step runs are handled by takos-agent-engine, written in Rust.",
    },
    {
      key: "memory",
      eyebrow: "memory",
      name: "Keep",
      body: "Artifacts stay as files and the exchange accrues as memory inside the Workspace. The next chat picks up where this one ended.",
    },
  ],
  apps: {
    title: "Installable apps",
    lede:
      "Install a Capsule from “Add from Git URL” on the Apps screen: a tile joins the Workspace, and the tools the app publishes join the agent's toolbox over MCP.",
    items: [
      {
        name: "takos-office",
        body: "An office suite that unifies docs, slides, and sheets in one worker. Agents edit files directly over MCP.",
      },
      {
        name: "takos-computer",
        body: "A computer-use environment your agents can call — browser actions and command execution, handed off.",
      },
      {
        name: "yurucommu",
        body: "Self-hosted ActivityPub social. An independent product on the fediverse, installable as a Capsule.",
      },
    ],
  },
  data: {
    title: "Data",
    points: [
      "Chats, memory, and files are stored in a Workspace on your own server",
      "Export everything and move to another substrate anytime",
      "Runtime is the Cloudflare adapter (OpenTofu module); other substrates can be added as adapters",
      "Connects to other Takos and the fediverse over ActivityPub",
    ],
  },
  install: {
    title: "Install",
    lede: [
      { t: "Following the link opens the " },
      { t: "Takosumi", code: true },
      { t: " install screen. Review what's inside, add it to your own place, and start using it." },
    ],
    cards: [
      {
        kind: "use",
        title: "Just use it",
        body: "Log in and follow the on-screen guide. Until the public launch is ready, the guide pauses partway through.",
        cta: "Use it",
      },
      {
        kind: "git",
        title: "Install as a Capsule",
        body: "The Takosumi install screen shows the app and where it goes. Review it and install.",
        cta: "Open install",
      },
      {
        kind: "self",
        title: "Run it on your own server",
        body: "Pin the Git release tag, install dependencies, review an OpenTofu plan, then apply.",
      },
    ],
  },
  visuals: {
    chat: {
      alt: "Actual Takos screen: a chat request where the agent ran tools and saved a file to docs",
    },
    thread: {
      alt: "Actual Takos screen: a chat thread with the agent reporting tool-run results",
    },
    work: {
      alt: "Actual Takos screen: Work Tasks listing planned, in-progress, and completed tasks",
    },
    memory: {
      alt: "Actual Takos screen: the memory list with episode, knowledge, and procedure cards",
    },
  },
  footer: {
    copyright: "© Takos contributors — AGPL · Powered by Takosumi.",
    links: [
      { label: "Docs", href: "https://docs.takos.jp/", external: true },
      {
        label: "GitHub",
        href: "https://github.com/tako0614/takos",
        external: true,
      },
      { label: "Takosumi", href: "https://takosumi.com/", external: true },
      { label: "Cloud", href: "#cloud", cloud: true },
    ],
  },
};

export const SITE: Record<Locale, Strings> = { ja, en };
