export interface Feature {
  readonly title: string;
  readonly body: string;
}

export const FEATURES: readonly Feature[] = [
  {
    title: "Chat / agent / memory / space",
    body: "Core はこの 4 つ。 LLM とのやり取りは agent が回し、 memory はあなたの space に積み上がる。 履歴は自分のサーバーから出ない。",
  },
  {
    title: "Bundled apps が auto-install",
    body: "takos-docs / takos-slide / takos-excel / takos-computer / yurucommu — 新規 space 作成と同時に install 済み。 不要なら uninstall できる。",
  },
  {
    title: "Takosumi 上で動く",
    body: "Takos は Takosumi PaaS の上で動く top-level product。 だから Cloudflare / AWS / GCP / docker / 自前 VM のどこにでも同じ manifest で deploy できる。",
  },
  {
    title: "Federation で繋がる",
    body: "ActivityPub 経由で他の Takos インスタンスや fediverse と connection。 サイロ化しない、 でも自分の data は自分の VM の中。",
  },
  {
    title: "Self-host first",
    body: "個人の small VM から enterprise の K8s cluster まで、 同じ Takos binary が動く。 SaaS lock-in も vendor lock-in も無し。",
  },
  {
    title: "OSS / forkable",
    body: "AGPL。 コード全部 public で、 fork してあなた仕様にできる。 contributor も歓迎。",
  },
];
