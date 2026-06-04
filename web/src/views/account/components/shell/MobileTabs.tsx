import { A, useLocation } from "@solidjs/router";
import { Bell, Home, LayoutGrid, UserCircle2 } from "lucide-solid";

const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/apps", label: "Apps", icon: LayoutGrid },
  { href: "/notifications", label: "通知", icon: Bell },
  { href: "/account", label: "Account", icon: UserCircle2 },
];

/** Ported from takosumi dashboard-ui/src/components/shell/MobileTabs.tsx. */
export default function MobileTabs() {
  const loc = useLocation();
  return (
    <nav class="mobile-tabs" aria-label="Mobile primary">
      {TABS.map((t) => (
        <A
          href={t.href}
          class="mobile-tab"
          classList={{
            active: loc.pathname === t.href ||
              loc.pathname.startsWith(t.href + "/"),
          }}
        >
          <t.icon size={20} />
          <span>{t.label}</span>
        </A>
      ))}
    </nav>
  );
}
