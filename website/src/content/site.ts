/**
 * Bilingual content dictionary for the Takos landing site.
 *
 * `ja` is the source-of-truth voice (Takos is JP-first); `en` mirrors it for
 * discoverability. Both locales are prerendered as separate routes (`/` and
 * `/en/`). Keep product nouns (chat / agent / memory / Workspace, bundled apps,
 * Takosumi, Installation) identical across locales — only the connective prose
 * is translated. Do NOT describe Takosumi concepts as Takos features, and do
 * not soften the platform-readiness launch gate (see AGENTS.md 中核原則).
 */

export type Locale = "ja" | "en";
export const LOCALES: readonly Locale[] = ["ja", "en"];

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

/** A product-core showcase row (chat / agent / memory / Workspace). The `key`
 *  selects which abstract CSS visual the Showcase component renders. */
export interface ShowcaseItem {
  readonly key: "chat" | "agent" | "memory" | "space";
  readonly name: string;
  readonly tagline: string;
  readonly body: Rich;
  readonly points: readonly string[];
}

export interface AppItem {
  readonly name: string;
  readonly tag: string;
  readonly role: string;
  readonly body: string;
}

export interface CompareRow {
  readonly label: string;
  readonly us: string;
  readonly them: string;
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
    readonly why: string;
    readonly features: string;
    readonly apps: string;
    readonly docs: string;
    readonly install: string;
    readonly openMenu: string;
    readonly closeMenu: string;
  };
  readonly hero: {
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
    readonly title: string;
    readonly lede: Rich;
    readonly points: readonly Item[];
  };
  readonly showcase: {
    readonly title: string;
    readonly lede: string;
    readonly items: readonly ShowcaseItem[];
  };
  readonly apps: {
    readonly title: string;
    readonly lede: string;
    readonly items: readonly AppItem[];
  };
  readonly compare: {
    readonly title: string;
    readonly lede: string;
    readonly colUs: string;
    readonly colThem: string;
    readonly rows: readonly CompareRow[];
  };
  readonly install: {
    readonly title: string;
    readonly lede: Rich;
    readonly cards: readonly InstallCard[];
  };
  readonly footer: {
    readonly tagline: string;
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
    title: "Takos — AI と話す場所は、あなたのサーバーで。",
    description:
      "Takos は self-hostable な AI-first chat & agent product。chat / agent / memory / Git / Workspace / app launcher / MCP tools を core に持ち、office (docs / slide / sheet) / computer / social などの bundled apps が新規 Workspace に seed される。OpenTofu module + Worker artifact で self-host できる AGPL の OSS。",
    ogTitle: "Takos — AI-first chat & agent, your own server.",
    ogDescription:
      "Self-hostable な AI-first chat & agent。history も memory も自分のサーバーの中。OpenTofu module + Worker artifact で self-host。AGPL の OSS。",
  },
  nav: {
    why: "なぜ Takos",
    features: "中身",
    apps: "Bundled apps",
    docs: "Docs",
    install: "Install",
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
  },
  hero: {
    title: [{ t: "AI agent" }, { t: "for me", grad: true }],
    lede: [
      { t: "自分のための AI agent。chat / agent / memory / Workspace を、" },
      { t: "自分のサーバーの中で", em: true },
      { t: "。ログインしてすぐ始められます。" },
    ],
    useTakos: "Takos を使う",
    gitInstall: "Git から install",
    scroll: "scroll",
    termComment1: "# どこにでも install できるが、一番速いのは Use Takos。",
    termComment2:
      "# 自前 substrate では Git source を install lifecycle に渡す:",
    termOk1: "✓ takos-worker → http://your-takos.example/",
    termOk2: "✓ takos-git → docs / files / agents",
    copy: "コピー",
    copied: "コピーしました",
  },
  why: {
    title: "ソフトウェアを、自分の手に。",
    lede: [
      { t: "AI は日常のインフラになりつつある。だからこそ、" },
      { t: "誰と話したか・何を覚えさせたか", em: true },
      {
        t: " が他社のサーバーに溜まり続けるのは、おかしい。Takos は chat も agent も memory も、",
      },
      { t: "あなたが所有するサーバーの中で", em: true },
      { t: " 完結させます。" },
    ],
    points: [
      {
        title: "データ主権",
        body: "会話・memory・file は、すべて自分の VM / cloud の中に置かれる。ベンダーのサーバーに溜まり続けることがなく、いつでも丸ごと export して別の環境へ移せる。",
      },
      {
        title: "ロックインしない",
        body: "SaaS にも特定ベンダーにも縛られない。同じ Takos が Cloudflare / AWS / GCP / Kubernetes / 自前 VM の上で動き、substrate は後からでも乗り換えられる。",
      },
      {
        title: "fork できる自由",
        body: "AGPL でコードは全部 public。自分の用途に合わせて fork し、機能を足しても外しても自由。ブラックボックスの「提供される範囲」に閉じ込められない。",
      },
    ],
  },
  showcase: {
    title: "4 つの core が、噛み合う。",
    lede: "chat で話し、agent が動き、memory が積み上がり、Workspace がぜんぶを束ねる。単体の機能ではなく、噛み合って初めて「自分の AI 環境」になる。",
    items: [
      {
        key: "chat",
        name: "Chat",
        tagline: "複数モデルを、1 つのスレッドで。",
        body: [
          { t: "クラウドの LLM もローカルモデルも、同じ会話の中で切り替えながら使える。会話は thread として Workspace に整理され、" },
          { t: "履歴はすべて自分のサーバーの中", em: true },
          { t: "。どのモデルに何を話したかが、他社に渡らない。" },
        ],
        points: [
          "複数 LLM をスレッド内で切り替え",
          "thread 単位で Workspace に整理",
          "履歴は自分のサーバーに保存",
        ],
      },
      {
        key: "agent",
        name: "Agent",
        tagline: "tool を呼び、file を触り、手順を回す。",
        body: [
          { t: "Rust 製の agent engine が、" },
          { t: "tool 呼び出し・ファイル操作・複数ステップの実行", em: true },
          { t: " を担う。MCP 経由で bundled app にも繋がり、docs を書いたり sheet を更新したりを agent に任せられる。" },
        ],
        points: [
          "Rust 製 agent engine が実行",
          "MCP で app / tool に接続",
          "長い手順を自動化",
        ],
      },
      {
        key: "memory",
        name: "Memory",
        tagline: "話すほど、文脈が育つ。",
        body: [
          { t: "やり取りから memory が Workspace に積み上がり、次の会話へ文脈が引き継がれる。" },
          { t: "memory も自分のサーバーの中", em: true },
          { t: " にあり、学習に使われたり外に出たりしない。" },
        ],
        points: [
          "会話から memory が蓄積",
          "次のチャットへ文脈を引き継ぎ",
          "ベンダー学習に使われない",
        ],
      },
      {
        key: "space",
        name: "Workspace",
        tagline: "人・agent・app・data の単位。",
        body: [
          { t: "Workspace は活動の単位。" },
          { t: "Workspace ごとに分離・権限管理", em: true },
          { t: " され、新規作成と同時に bundled app が auto-install される。必要なら ActivityPub で他の Takos や fediverse とも繋がれる。" },
        ],
        points: [
          "Workspace ごとに分離・権限管理",
          "bundled app が auto-install",
          "ActivityPub で federation",
        ],
      },
    ],
  },
  apps: {
    title: "新規 Workspace で、すぐ揃う。",
    lede: "Takos distribution と一緒に ship される 1st-party の InstallableApp。新規 Workspace 作成と同時に install 済みで、必要なければ uninstall できる。",
    items: [
      {
        name: "takos-office",
        tag: "office",
        role: "docs / slide / sheet",
        body: "文書 (docs)・プレゼン (slide)・表計算 (sheet) を 1 つの worker に統合した office suite。MCP 経由で agent が直接ファイルを編集でき、Google Docs / Slides / Sheets の代替を自分の Workspace の中で完結させる。",
      },
      {
        name: "takos-computer",
        tag: "agent-tool",
        role: "computer use",
        body: "agent から呼び出せる computer use 環境。ブラウザ操作やコマンド実行といった手順を agent に渡し、定型作業をまるごと自動化できる。",
      },
      {
        name: "yurucommu",
        tag: "social",
        role: "ActivityPub social",
        body: "self-hosted な ActivityPub / community social。fediverse に繋がる独立 product で、新規 Workspace に seed される。data は自分の中に置いたまま外と繋がれる。",
      },
    ],
  },
  compare: {
    title: "預けるか、所有するか。",
    lede: "自分のサーバーで動かす Takos と、提供元に預ける SaaS chat の典型的な違い。data が誰のものか、という観点で並べています (すべての SaaS に当てはまるわけではありません)。",
    colUs: "Takos (self-host)",
    colThem: "SaaS chat (預ける)",
    rows: [
      {
        label: "data の所在",
        us: "自分の VM / cloud",
        them: "ベンダーのサーバー",
      },
      {
        label: "memory / 履歴",
        us: "自分の Workspace に保持",
        them: "提供元が保持・学習に利用しうる",
      },
      {
        label: "ベンダーロックイン",
        us: "いつでも export・移行",
        them: "移行は困難なことが多い",
      },
      {
        label: "カスタマイズ",
        us: "AGPL で fork 自由",
        them: "提供される範囲のみ",
      },
      { label: "Federation", us: "ActivityPub で接続", them: "基本クローズド" },
      {
        label: "料金 (self-host)",
        us: "ソフトは無料 (基盤費のみ)",
        them: "seat / 従量課金",
      },
    ],
  },
  install: {
    title: "始めるのは、ボタン 1 つから。",
    lede: [
      { t: "むずかしい設定はいりません。リンクを押すと " },
      { t: "Takosumi", code: true },
      {
        t: " の導入画面が開き、中身を確認してから自分の場所に入れて、そのまま使えます。だれでも同じ入口です。",
      },
    ],
    cards: [
      {
        kind: "use",
        title: "すぐ使う",
        body: "いちばん簡単な入口。ログインして、画面の案内にそって進むだけで Takos を始められます。一般公開の準備が整うまでは、案内の途中でいったん止まります。",
        cta: "すぐ使う",
      },
      {
        kind: "git",
        title: "リンクから入れる",
        body: "ボタンを押すと導入画面が開き、入れるアプリと入れる先が分かりやすく表示されます。中身を確認してそのまま導入。エンジニアでなくてもここから始められます（取得元の細かい設定は折りたたみの中にあります）。",
        cta: "リンクから入れる",
      },
      {
        kind: "self",
        title: "自分のサーバーで動かす",
        body: "自分のインフラで動かしたい人向け。同じ Git の取得元を、自前の Takosumi に CLI から入れられます。クラウドの種類などは自分で選べます。",
      },
    ],
  },
  footer: {
    tagline: "AI と話す場所は、あなたのサーバーで。",
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
    title: "Takos — AI-first chat & agent, on your own server.",
    description:
      "Takos is a self-hostable, AI-first chat & agent product. Its core is chat / agent / memory / Workspace, and bundled apps like office (docs / slide / sheet) / computer / social auto-install with every new Workspace. It runs on Takosumi, so you can install it on Cloudflare, AWS, GCP, or your own VM — and your history and memory never leave your server. Open source under AGPL.",
    ogTitle: "Takos — AI-first chat & agent, your own server.",
    ogDescription:
      "A self-hostable AI chat & agent. Your history and memory stay on your own server. One-click install on Takosumi, or install from a Git source on your own substrate. Open source, AGPL.",
  },
  nav: {
    why: "Why Takos",
    features: "Inside",
    apps: "Bundled apps",
    docs: "Docs",
    install: "Install",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  hero: {
    title: [{ t: "AI agent" }, { t: "for me", grad: true }],
    lede: [
      { t: "Your own AI agent — chat, agent, memory, and Workspace, " },
      { t: "on a server you own", em: true },
      { t: ". Log in and start in seconds." },
    ],
    useTakos: "Use Takos",
    gitInstall: "Install from Git",
    scroll: "scroll",
    termComment1:
      "# You can install it anywhere, but Use Takos is the fastest.",
    termComment2:
      "# On your own substrate, hand a Git source to the install lifecycle:",
    termOk1: "✓ takos-worker → http://your-takos.example/",
    termOk2: "✓ takos-git → docs / files / agents",
    copy: "Copy",
    copied: "Copied",
  },
  why: {
    title: "Own your software.",
    lede: [
      { t: "AI is becoming everyday infrastructure. So it is strange that " },
      { t: "who you talked to and what you taught it", em: true },
      {
        t: " keeps piling up on someone else’s server. Takos keeps chat, agent, and memory ",
      },
      { t: "inside a server you own", em: true },
      { t: "." },
    ],
    points: [
      {
        title: "Data sovereignty",
        body: "Conversations, memory, and files all sit inside your own VM or cloud. Nothing piles up on a vendor’s servers, and you can export everything and move to another environment anytime.",
      },
      {
        title: "No lock-in",
        body: "Tied to neither a SaaS nor a single vendor. The same Takos runs on Cloudflare, AWS, GCP, Kubernetes, or your own VM — and you can switch substrate later.",
      },
      {
        title: "Freedom to fork",
        body: "AGPL, with all code public. Fork it for your needs — add features or remove them. You are never boxed into a black-box “as offered” scope.",
      },
    ],
  },
  showcase: {
    title: "Four cores that mesh.",
    lede: "Chat to talk, agents to act, memory that accumulates, and a Workspace that ties it together. They become your own AI environment only when they mesh — not as standalone features.",
    items: [
      {
        key: "chat",
        name: "Chat",
        tagline: "Many models, one thread.",
        body: [
          { t: "Use cloud LLMs and local models, switching between them in the same conversation. Threads are organized inside a Workspace, and " },
          { t: "all history stays on your own server", em: true },
          { t: ". What you said to which model never leaves for a vendor." },
        ],
        points: [
          "Switch LLMs within a thread",
          "Organized as threads per Workspace",
          "History stays on your server",
        ],
      },
      {
        key: "agent",
        name: "Agent",
        tagline: "Calls tools, touches files, runs steps.",
        body: [
          { t: "A Rust agent engine handles " },
          { t: "tool calls, file operations, and multi-step runs", em: true },
          { t: ". Over MCP it reaches the bundled apps too — let an agent write docs or update a sheet." },
        ],
        points: [
          "Rust agent engine executes",
          "Connects to apps / tools via MCP",
          "Automates long procedures",
        ],
      },
      {
        key: "memory",
        name: "Memory",
        tagline: "The more you talk, the more context grows.",
        body: [
          { t: "Memory accumulates in the Workspace from your interactions and carries context into the next chat. " },
          { t: "Memory also lives on your own server", em: true },
          { t: " — never trained on, never sent out." },
        ],
        points: [
          "Memory accrues from chats",
          "Context carries to the next chat",
          "Not used for vendor training",
        ],
      },
      {
        key: "space",
        name: "Workspace",
        tagline: "The unit of people, agents, apps, and data.",
        body: [
          { t: "A Workspace is the unit of activity. " },
          { t: "Each Workspace is isolated, with its own permissions", em: true },
          { t: ", and bundled apps auto-install the moment you create one. Connect to other Takos and the fediverse over ActivityPub when you want." },
        ],
        points: [
          "Isolation & permissions per Workspace",
          "Bundled apps auto-install",
          "Federation via ActivityPub",
        ],
      },
    ],
  },
  apps: {
    title: "Ready the moment you start.",
    lede: "First-party InstallableApps shipped with the Takos distribution. Included with every new Workspace, and removable if you don’t need them.",
    items: [
      {
        name: "takos-office",
        tag: "office",
        role: "docs / slide / sheet",
        body: "An office suite that unifies docs, slides, and sheets in one worker. Agents can edit files directly over MCP, so you replace Google Docs / Slides / Sheets inside your own Workspace.",
      },
      {
        name: "takos-computer",
        tag: "agent-tool",
        role: "computer use",
        body: "A computer-use environment your agents can call — hand off browser actions and command execution to automate routine, multi-step work.",
      },
      {
        name: "yurucommu",
        tag: "social",
        role: "ActivityPub social",
        body: "Self-hosted ActivityPub / community social. An independent product that connects to the fediverse, seeded into new Workspaces — your data stays in while you reach out.",
      },
    ],
  },
  compare: {
    title: "Entrust it, or own it.",
    lede: "How running Takos on your own server differs from delegating to a SaaS provider — typical trade-offs framed around who owns the data (not true of every product).",
    colUs: "Takos (self-host)",
    colThem: "SaaS chat (delegated)",
    rows: [
      {
        label: "Where data lives",
        us: "Your own VM / cloud",
        them: "The vendor’s servers",
      },
      {
        label: "Memory / history",
        us: "Kept in your Workspace",
        them: "Held by the provider, may train on it",
      },
      {
        label: "Vendor lock-in",
        us: "Export / migrate anytime",
        them: "Migration is often hard",
      },
      {
        label: "Customization",
        us: "Fork freely under AGPL",
        them: "Only what is offered",
      },
      {
        label: "Federation",
        us: "Connected via ActivityPub",
        them: "Mostly closed",
      },
      {
        label: "Price (self-host)",
        us: "Software is free (infra only)",
        them: "Per-seat / usage billing",
      },
    ],
  },
  install: {
    title: "It starts with one button.",
    lede: [
      { t: "No tricky setup. Press the link and " },
      { t: "Takosumi", code: true },
      {
        t: "'s install screen opens — review what's inside, add it to your own place, and start using it. Same entrance for everyone.",
      },
    ],
    cards: [
      {
        kind: "use",
        title: "Just use it",
        body: "The easiest way in. Log in and follow the on-screen guide to start Takos. Until the public launch is ready, the guide pauses partway through.",
        cta: "Just use it",
      },
      {
        kind: "git",
        title: "Install from a link",
        body: "The button opens the install screen showing, in plain terms, the app you are adding and where it goes. Review it and install. You do not need to be an engineer to start here (the finer source settings live inside a fold-out).",
        cta: "Install from a link",
      },
      {
        kind: "self",
        title: "Run it on your own server",
        body: "For people who want to run it on their own infrastructure. Install the same Git source onto your own Takosumi from the CLI. You choose the cloud and the rest yourself.",
      },
    ],
  },
  footer: {
    tagline: "The place you talk to AI is your own server.",
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
