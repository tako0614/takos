/**
 * Bilingual content dictionary for the Takos landing site.
 *
 * `ja` is the source-of-truth voice (Takos is JP-first); `en` mirrors it for
 * discoverability. Both locales are prerendered as separate routes (`/` and
 * `/en/`). Keep product nouns (chat / agent / memory / Workspace, installable apps,
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

/** Which real-UI surface the AppVisual component renders. */
export type AppVisualKind = "chat" | "agent" | "memory" | "space";

/** One step of the run sequence — the same request moving through surfaces.
 *  `key` selects which real-UI visual the Run section renders. */
export interface RunStep {
  readonly key: "chat" | "agent" | "memory";
  readonly state: string;
  readonly name: string;
  readonly connect: string;
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
    readonly workspace: string;
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
  readonly run: {
    readonly title: string;
    readonly lede: string;
    readonly request: string;
    readonly steps: readonly RunStep[];
  };
  readonly workspace: {
    readonly title: string;
    readonly lede: Rich;
    readonly points: readonly string[];
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
      "Takos は self-hostable な AI-first chat & agent product。chat / agent / memory / Git / Workspace / app launcher / MCP tools を core に持ち、office (docs / slide / sheet) / computer / social などの installable apps を選んで追加できる。OpenTofu module + Worker artifact で self-host できる AGPL の OSS。",
    ogTitle: "Takos — AI-first chat & agent, your own server.",
    ogDescription:
      "Self-hostable な AI-first chat & agent。history も memory も自分のサーバーの中。OpenTofu module + Worker artifact で self-host。AGPL の OSS。",
  },
  nav: {
    why: "なぜ Takos",
    features: "使い方",
    workspace: "Workspace",
    apps: "Installable apps",
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
      "# 自前の実行基盤では Git source を install lifecycle に渡す:",
    termOk1: "✓ takos-worker → http://your-takos.example/",
    termOk2: "✓ takos-git → docs / files / agents",
    copy: "コピー",
    copied: "コピーしました",
  },
  why: {
    title: "だから、自分のサーバーで。",
    lede: [
      {
        t: "ここまでの run で起きたこと — 依頼の内容、tool が触れた file、残った docs、積み上がった memory — は全部 ",
      },
      { t: "あなたのサーバーの中", em: true },
      {
        t: " にあります。AI が日常のインフラになるなら、誰と話したか・何を覚えさせたかが他社のサーバーに溜まり続けるのは、おかしい。",
      },
    ],
    points: [
      {
        title: "データ主権",
        body: "会話・memory・file は自分の VM / cloud の中に置かれ、いつでも丸ごと export して別の環境へ移せる。",
      },
      {
        title: "ロックインしない",
        body: "deploy は OpenTofu module として宣言。現在の supported adapter は Cloudflare で、別の実行基盤は adapter を足せる。",
      },
      {
        title: "fork できる自由",
        body: "AGPL でコードは全部 public。自分の用途に合わせて機能を足しても外しても自由。",
      },
    ],
  },
  run: {
    title: "頼む。残る。",
    lede: "ひとつの依頼が Takos の中をどう進むか。chat・Work board・Memory は別々の機能ではなく、1 本の run の途中経過です。",
    request: "Draft the v0.12.7 release notes and save them to docs",
    steps: [
      {
        key: "chat",
        state: "依頼 → 実行",
        name: "Chat で頼む",
        connect:
          "やりたいことをそのまま書く。クラウドの LLM もローカルモデルも同じスレッドで切り替えられ、agent がその場で tool を呼んで動き始める。",
      },
      {
        key: "agent",
        state: "進行 → 完了",
        name: "Work board で進む",
        connect:
          "同じ job が Work Tasks に task として載り、In Progress から Run completed まで状態で追える。tool 呼び出しと複数ステップの実行は Rust 製の agent engine が担う。",
      },
      {
        key: "memory",
        state: "保存 → 蓄積",
        name: "docs に残り、Memory に効く",
        connect:
          "成果物は install した takos-office の docs に file として残り、やり取りは Memory に蓄積する。次の会話は続きから始まる。",
      },
    ],
  },
  workspace: {
    title: "舞台は、Workspace。",
    lede: [
      { t: "この run が起きている場所が Workspace。" },
      { t: "Workspace ごとに分離・権限管理", em: true },
      {
        t: " され、必要な app を選んで追加できる。必要なら ActivityPub で他の Takos や fediverse とも繋がれる。",
      },
    ],
    points: [
      "Workspace ごとに分離・権限管理",
      "必要な app を選んで追加",
      "ActivityPub で federation",
    ],
  },
  apps: {
    title: "toolbox は、install で育つ。",
    lede: "Apps 画面の「Add from Git URL」から Capsule を install すると、Workspace に tile が並び、その app が公開する tool が MCP 経由で agent の toolbox に加わる。さっきの run で docs に保存できたのも、install 済みの takos-office の tool だった。",
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
        body: "self-hosted な ActivityPub / community social。fediverse に繋がる独立 product で、通常の Capsule として Workspace に追加できる。data は自分の中に置いたまま外と繋がれる。",
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
        body: "自分のインフラで動かしたい人向け。Git の release tag を固定して、依存パッケージを入れ、OpenTofu の plan を確認してから apply します。クラウドの種類などは自分で選べます。",
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
      "Takos is a self-hostable, AI-first chat & agent product. Its core is chat / agent / memory / Workspace, and installable apps like office (docs / slide / sheet), computer, and social can be added when you need them. It runs on Takosumi, so you can install it on your own substrate — the current supported adapter is Cloudflare — and your history and memory are stored on your own server. Open source under AGPL.",
    ogTitle: "Takos — AI-first chat & agent, your own server.",
    ogDescription:
      "A self-hostable AI chat & agent. Your history and memory are stored on your own server. One-click install on Takosumi, or install from a Git source on your own substrate. Open source, AGPL.",
  },
  nav: {
    why: "Why Takos",
    features: "How it runs",
    workspace: "Workspace",
    apps: "Installable apps",
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
    title: "Which is why it runs on your server.",
    lede: [
      {
        t: "Everything in that run — the request, the files the tools touched, the saved docs, the accumulated memory — stays ",
      },
      { t: "inside your server", em: true },
      {
        t: ". If AI is becoming everyday infrastructure, who you talked to and what you taught it shouldn’t keep piling up on someone else’s.",
      },
    ],
    points: [
      {
        title: "Data sovereignty",
        body: "Conversations, memory, and files sit inside your own VM or cloud, and you can export everything and move anytime.",
      },
      {
        title: "No lock-in",
        body: "Deploy is declared as a plain OpenTofu module. The current supported adapter is Cloudflare; other substrates can be added as adapters.",
      },
      {
        title: "Freedom to fork",
        body: "AGPL, with all code public. Fork it for your needs — add features or remove them.",
      },
    ],
  },
  run: {
    title: "Ask. It stays.",
    lede: "Follow one request through Takos. Chat, the Work board, and Memory aren’t separate features — they’re one run in progress.",
    request: "Draft the v0.12.7 release notes and save them to docs",
    steps: [
      {
        key: "chat",
        state: "asked → running",
        name: "Ask in Chat",
        connect:
          "Write what you want in plain words. Cloud LLMs and local models switch within the same thread, and the agent starts calling tools on the spot.",
      },
      {
        key: "agent",
        state: "in progress → completed",
        name: "It progresses on the Work board",
        connect:
          "The same job lands on Work Tasks and moves from In Progress to Run completed. A Rust agent engine handles the tool calls and multi-step execution.",
      },
      {
        key: "memory",
        state: "saved → remembered",
        name: "Kept in docs, carried by Memory",
        connect:
          "The artifact stays as a file in docs — here, via the installed takos-office — and the exchange accrues in Memory. The next chat starts where this one left off.",
      },
    ],
  },
  workspace: {
    title: "The stage is a Workspace.",
    lede: [
      { t: "A Workspace is where this run happens. " },
      {
        t: "Each Workspace is isolated, with its own permissions",
        em: true,
      },
      {
        t: ", and you add the apps you need to it. Connect to other Takos and the fediverse over ActivityPub when you want.",
      },
    ],
    points: [
      "Isolation & permissions per Workspace",
      "Add the apps you need",
      "Federation via ActivityPub",
    ],
  },
  apps: {
    title: "The toolbox grows by install.",
    lede: "Install a Capsule from “Add from Git URL” on the Apps screen: a tile joins the Workspace, and the tools the app publishes join the agent’s toolbox over MCP. The docs save in the run above worked because an installed takos-office tool was already in the toolbox.",
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
        body: "Self-hosted ActivityPub / community social. An independent product that connects to the fediverse and can be installed as a normal Capsule — your data stays in while you reach out.",
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
        body: "For people who want to run it on their own infrastructure. Pin the Git release tag, install dependencies, review an OpenTofu plan, and then apply it. You choose the cloud and the rest yourself.",
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
