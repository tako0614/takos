interface Props {
  status?: string;
  class?: string;
}

// Aligned with the canonical contract enum. The canonical list is
// `installing` / `ready` / `failed` / `suspended` / `exported`.
const LABEL: Record<string, string> = {
  ready: "稼働中",
  installing: "インストール中",
  failed: "失敗",
  suspended: "停止中",
  exported: "エクスポート済み",
};

/** Ported from takosumi dashboard-ui/src/components/apps/AppStatusPill.tsx. */
export default function AppStatusPill(props: Props) {
  const s = () => props.status ?? "unknown";
  return (
    <span class={`status-pill status-${s()} ${props.class ?? ""}`}>
      {LABEL[s()] ?? s()}
    </span>
  );
}
