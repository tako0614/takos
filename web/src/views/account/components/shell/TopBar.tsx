import { A } from "@solidjs/router";
import { Bell } from "lucide-solid";
import UserMenu from "../auth/UserMenu.tsx";

/**
 * Ported from takosumi dashboard-ui/src/components/shell/TopBar.tsx.
 * ThemeToggle dropped — takos is dark-only per the shared design language.
 */
export default function TopBar() {
  return (
    <header class="topbar">
      <div class="topbar-actions">
        <A href="/notifications" class="topbar-icon-btn" aria-label="通知">
          <Bell size={18} />
        </A>
        <UserMenu />
      </div>
    </header>
  );
}
