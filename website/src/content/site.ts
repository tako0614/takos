/**
 * Bilingual content dictionary for the Takos site.
 *
 * The page is a product document, not a landing funnel: a factual head
 * (name, descriptor, spec), then numbered sections that trace one real run
 * through the actual UI. 'ja' is the source-of-truth voice (Takos is
 * JP-first); 'en' mirrors it. Keep product nouns (chat / agent / memory /
 * Workspace, installable apps, Takosumi) identical across locales. Do NOT
 * describe Takosumi concepts as Takos features, and do not soften the
 * platform-readiness launch gate (see AGENTS.md 中核原則).
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

export interface Item {
  readonly title: string;
  readonly body: string;
}

/** Term/definition row used by the head spec and the data section. */
export interface DefRow {
  readonly term: string;
  readonly def: string;
}

/** Which real screen the AppVisual component renders (public/screens). */
export type AppVisualKind = "chat" | "thread" | "work" | "memory" | "install";

/** Alt text + caption for one real screenshot. */
export interface VisualCopy {
  readonly alt: string;
  readonly caption: string;
}

/** One step of the run sequence — the same request moving through surfaces.
 *  'key' selects which real-UI visual the Run section renders. */
export interface RunStep {
  readonly key: AppVisualKind;
  readonly name: string;
  readonly connect: string;
}

export interface AppItem {
  readonly name: string;
  readonly tag: string;
  readonly role: string;
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
    readonly run: string;
    readonly apps: string;
    readonly data: string;
    readonly install: string;
    readonly docs: string;
    readonly openMenu: string;
    readonly closeMenu: string;
  };
  readonly head: {
    readonly tagline: string;
    readonly lede: Rich;
    readonly useTakos: string;
    readonly github: string;
    readonly docs: string;
    readonly spec: readonly DefRow[];
  };
  readonly run: {
    readonly title: string;
    readonly lede: string;
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
  readonly data: {
    readonly title: string;
    readonly lede: Rich;
    readonly rows: readonly DefRow[];
  };
  readonly install: {
    readonly title: string;
    readonly lede: Rich;
    readonly cards: readonly InstallCard[];
  };
  readonly visuals: Record<AppVisualKind, VisualCopy>;
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
      "Takos は self-hostable な chat & agent product。chat で頼むと agent が tool を呼んで仕事を進め、task と成果物は Workspace に残り、やり取りは memory に蓄積する。office / computer / social などの installable apps を Capsule として追加でき、OpenTofu module で self-host できる AGPL の OSS。",
    ogTitle: "Takos",
    ogDescription:
      "Self-hosted AI workspace。chat で頼むと agent が tool を呼んで仕事を進める。全部、自分のサーバーの中で。OpenTofu module で self-host、AGPL の OSS。",
  },
  nav: {
    run: "使い方",
    apps: "Apps",
    data: "データ",
    install: "導入",
    docs: "Docs",
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
  },
  head: {
    tagline: "Self-hosted AI workspace.",
    lede: [
      { t: "chat で頼むと、agent が tool を呼んで仕事を進める。task と成果物は Workspace に残り、やり取りは memory に蓄積する。その全部を、" },
      { t: "自分のサーバーの中で", em: true },
      { t: " 動かせる。" },
    ],
    useTakos: "使う",
    github: "GitHub",
    docs: "Docs",
    spec: [
      { term: "license", def: "AGPL-3.0" },
      { term: "upstream", def: "github.com/tako0614/takos" },
      { term: "engine", def: "takos-agent-engine (Rust)" },
      { term: "runtime", def: "Cloudflare Workers — OpenTofu module" },
      { term: "install", def: "Takosumi Capsule · Git URL · OpenTofu" },
    ],
  },
  run: {
    title: "使い方",
    lede: "ひとつの依頼が Takos の中をどう進むか。chat・Work board・Memory は別々の機能ではなく、1 本の run の途中経過。",
    steps: [
      {
        key: "thread",
        name: "Chat で頼む",
        connect:
          "やりたいことをそのまま書く。クラウドの LLM もローカルモデルも同じスレッドで切り替えられ、agent がその場で tool を呼ぶ。",
      },
      {
        key: "work",
        name: "Work board で進む",
        connect:
          "job は Work Tasks に task として載り、状態で追える。tool 呼び出しと複数ステップの実行は Rust 製の agent engine が担う。",
      },
      {
        key: "memory",
        name: "docs に残り、memory に効く",
        connect:
          "成果物は install した takos-office の docs に file として残り、やり取りは memory に蓄積する。次の会話は続きから始まる。",
      },
    ],
  },
  workspace: {
    title: "Workspace",
    lede: [
      { t: "run が起きている場所。" },
    ],
    points: [
      "Workspace ごとに分離・権限管理",
      "必要な app を選んで追加",
      "ActivityPub で federation",
    ],
  },
  apps: {
    title: "Installable apps",
    lede:
      "Apps 画面の「Add from Git URL」から Capsule を install すると、Workspace に tile が並び、その app が公開する tool が MCP 経由で agent の toolbox に加わる。さっきの run で docs に保存できたのも、install 済みの takos-office の tool だった。",
    items: [
      {
        name: "takos-office",
        tag: "office",
        role: "docs / slide / sheet",
        body: "文書 (docs)・プレゼン (slide)・表計算 (sheet) を 1 つの worker に統合した office suite。MCP 経由で agent が file を直接編集でき、Google Docs / Slides / Sheets の代替を自分の Workspace の中で完結させる。",
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
        body: "self-hosted な ActivityPub / community social。fediverse に繋がる独立 product で、通常の Capsule として Workspace に追加できる。",
      },
    ],
  },
  data: {
    title: "データの所在",
    lede: [
      {
        t: "run で起きたこと — 依頼の内容、tool が触れた file、残った docs、積み上がった memory — は全部 ",
      },
      { t: "あなたのサーバーの中", em: true },
      { t: " にある。" },
    ],
    rows: [
      { term: "会話・memory・file", def: "自分のサーバー内の Workspace に保存される" },
      { term: "export", def: "いつでも丸ごと export して別の環境へ移せる" },
      { term: "実行基盤", def: "Cloudflare adapter (OpenTofu module)。別の基盤は adapter を追加できる" },
      { term: "federation", def: "ActivityPub で他の Takos・fediverse と接続" },
      { term: "license", def: "AGPL-3.0 — fork・改変は自由" },
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
        body: "ログインして画面の案内にそって進むだけで始められる。一般公開の準備が整うまでは、案内の途中でいったん止まる。",
        cta: "使う",
      },
      {
        kind: "git",
        title: "Capsule として入れる",
        body: "導入画面に、入れる app と入れる先が表示される。中身を確認してそのまま導入できる。",
        cta: "入れる",
      },
      {
        kind: "self",
        title: "自分のサーバーで動かす",
        body: "自分のインフラで動かしたい人向け。release tag を固定し、依存を入れ、OpenTofu の plan を確認してから apply する。",
      },
    ],
  },
  visuals: {
    chat: {
      alt: "Takos の実画面: chat での依頼に agent が tool を実行し、docs にファイルを保存して返答している",
      caption: "chat — 依頼から tool 実行、返答まで",
    },
    thread: {
      alt: "Takos の実画面: chat スレッドで agent が tool 実行の結果を返している",
      caption: "chat thread — 依頼への tool 実行がその場で進む",
    },
    work: {
      alt: "Takos の実画面: Work Tasks に予定・進行中・完了の task が並んでいる",
      caption: "Work Tasks — task が状態で並ぶ",
    },
    memory: {
      alt: "Takos の実画面: memory 一覧にエピソード・知識・手順のカードが並んでいる",
      caption: "memory — 種別フィルタと評価つきで残る",
    },
    install: {
      alt: "Takos の実画面: install 画面に Git URL・OpenTofu・Takosumi Run・Capsule の導入経路が並んでいる",
      caption: "install — Git URL / OpenTofu / Capsule から入れる",
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
      "Takos is a self-hostable chat & agent product. Ask in chat and the agent calls tools to get work done; tasks and artifacts stay in the Workspace, and the exchange accrues in memory — all on your own server. Installable apps (office / computer / social) attach as Capsules. OpenTofu module, AGPL.",
    ogTitle: "Takos",
    ogDescription:
      "Self-hosted AI workspace. Ask in chat and the agent runs the tools. Everything stays on your own server. OpenTofu module, AGPL.",
  },
  nav: {
    run: "How it works",
    apps: "Apps",
    data: "Data",
    install: "Install",
    docs: "Docs",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  head: {
    tagline: "Self-hosted AI workspace.",
    lede: [
      {
        t: "Ask in chat and the agent calls tools to get the work done. Tasks and artifacts stay in the Workspace; the exchange accrues in memory. All of it runs ",
      },
      { t: "on a server you own", em: true },
      { t: "." },
    ],
    useTakos: "Use it",
    github: "GitHub",
    docs: "Docs",
    spec: [
      { term: "license", def: "AGPL-3.0" },
      { term: "upstream", def: "github.com/tako0614/takos" },
      { term: "engine", def: "takos-agent-engine (Rust)" },
      { term: "runtime", def: "Cloudflare Workers — OpenTofu module" },
      { term: "install", def: "Takosumi Capsule · Git URL · OpenTofu" },
    ],
  },
  run: {
    title: "How it works",
    lede:
      "One request, followed through Takos. Chat, the Work board, and memory are not separate features — they are stages of a single run.",
    steps: [
      {
        key: "thread",
        name: "Ask in chat",
        connect:
          "Write what you want in plain words. Cloud LLMs and local models switch inside the same thread, and the agent calls tools on the spot.",
      },
      {
        key: "work",
        name: "It moves on the Work board",
        connect:
          "The job lands on Work Tasks and is tracked by state. A Rust agent engine handles the tool calls and multi-step execution.",
      },
      {
        key: "memory",
        name: "Saved to docs, carried by memory",
        connect:
          "Artifacts stay as files in docs — here, via the installed takos-office — and the exchange accrues in memory. The next chat starts where this one left off.",
      },
    ],
  },
  workspace: {
    title: "Workspace",
    lede: [
      { t: "Where the run happens." },
    ],
    points: [
      "Isolation & permissions per Workspace",
      "Add the apps you need",
      "Federation via ActivityPub",
    ],
  },
  apps: {
    title: "Installable apps",
    lede:
      "Install a Capsule from “Add from Git URL” on the Apps screen: a tile joins the Workspace, and the tools the app publishes join the agent's toolbox over MCP. The docs save in the run above worked because an installed takos-office tool was already in the toolbox.",
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
  data: {
    title: "Where the data lives",
    lede: [
      {
        t: "Everything in a run — the request, the files the tools touched, the saved docs, the accumulated memory — stays ",
      },
      { t: "inside your server", em: true },
      { t: "." },
    ],
    rows: [
      { term: "chats, memory, files", def: "stored in a Workspace on your own server" },
      { term: "export", def: "export everything and move to another substrate anytime" },
      { term: "runtime", def: "Cloudflare adapter (OpenTofu module); other substrates can be added as adapters" },
      { term: "federation", def: "connects to other Takos and the fediverse over ActivityPub" },
      { term: "license", def: "AGPL-3.0 — fork and modify freely" },
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
        body: "Log in and follow the on-screen guide to start Takos. Until the public launch is ready, the guide pauses partway through.",
        cta: "Use it",
      },
      {
        kind: "git",
        title: "Install as a Capsule",
        body: "The install screen shows the app and where it goes. Review it and install — no engineering required to start here.",
        cta: "Install",
      },
      {
        kind: "self",
        title: "Run it on your own server",
        body: "For people who want their own infrastructure. Pin the Git release tag, install dependencies, review an OpenTofu plan, then apply.",
      },
    ],
  },
  visuals: {
    chat: {
      alt: "Actual Takos screen: a chat request where the agent ran tools and saved a file to docs",
      caption: "chat — request to tool run to reply",
    },
    thread: {
      alt: "Actual Takos screen: a chat thread with the agent reporting tool-run results",
      caption: "chat thread — tool runs answer in place",
    },
    work: {
      alt: "Actual Takos screen: Work Tasks listing planned, in-progress, and completed tasks",
      caption: "Work Tasks — tasks listed by state",
    },
    memory: {
      alt: "Actual Takos screen: the memory list with episode, knowledge, and procedure cards",
      caption: "memory — kept with type filters and ratings",
    },
    install: {
      alt: "Actual Takos screen: the install surface listing Git URL, OpenTofu, Takosumi Run, and Capsule sources",
      caption: "install — from Git URL, OpenTofu, or Capsule",
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
