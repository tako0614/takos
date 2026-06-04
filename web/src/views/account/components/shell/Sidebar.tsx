import { A, useLocation } from "@solidjs/router";
import { Bell, CreditCard, Home, LayoutGrid, UserCircle2 } from "lucide-solid";
import Wordmark from "../brand/Wordmark.tsx";

const ITEMS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/apps", label: "Apps", icon: LayoutGrid },
  { href: "/account", label: "Account", icon: UserCircle2 },
  { href: "/account/billing", label: "Billing", icon: CreditCard },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

/** Ported from takosumi dashboard-ui/src/components/shell/Sidebar.tsx. */
export default function Sidebar() {
  const loc = useLocation();
  const isActive = (href: string) =>
    loc.pathname === href || loc.pathname.startsWith(href + "/");
  return (
    <aside class="sidebar">
      <div class="sidebar-brand">
        <Wordmark href="/home" size={22} />
      </div>
      <nav class="sidebar-nav" aria-label="Primary">
        {ITEMS.map((it) => (
          <A
            href={it.href}
            class="sidebar-link"
            classList={{ active: isActive(it.href) }}
          >
            <it.icon size={18} />
            <span>{it.label}</span>
          </A>
        ))}
      </nav>
      <div class="sidebar-footer">
        <a
          href="https://docs.takos.jp/"
          target="_blank"
          rel="external noopener"
          class="sidebar-link sidebar-link-sub"
        >
          ドキュメント →
        </a>
      </div>
    </aside>
  );
}
