import { A, useLocation } from "@solidjs/router";

const TABS = [
  { suffix: "", label: "Overview" },
  { suffix: "/danger", label: "Danger" },
];

/** Ported from takosumi dashboard-ui/src/components/apps/AppDetailNav.tsx. */
export default function AppDetailNav(props: { installationId: string }) {
  const loc = useLocation();
  const base = `/apps/${encodeURIComponent(props.installationId)}`;
  const isActive = (suffix: string) => {
    const target = base + suffix;
    if (suffix === "") {
      return loc.pathname === target || loc.pathname === target + "/";
    }
    return loc.pathname === target;
  };
  return (
    <nav class="detail-nav" aria-label="App sections">
      {TABS.map((t) => (
        <A
          href={base + t.suffix}
          class="detail-nav-link"
          classList={{ active: isActive(t.suffix) }}
        >
          {t.label}
        </A>
      ))}
    </nav>
  );
}
