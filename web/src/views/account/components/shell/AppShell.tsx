import type { JSX } from "solid-js";
import Sidebar from "./Sidebar.tsx";
import TopBar from "./TopBar.tsx";
import MobileTabs from "./MobileTabs.tsx";
// The ported dashboard stylesheet (page-header / detail-section / kv-list /
// account-nav / app-card / data-table / sign-in-* / revoke-confirm / shell
// chrome classes). Imported once here so every account/installations screen
// that wraps in <AppShell> gets the styles.
import "../../account.css";

interface Props {
  children: JSX.Element;
}

/**
 * Dashboard chrome (sidebar + topbar + mobile tabs) for the account /
 * installations screens. Ported from
 * takosumi dashboard-ui/src/components/shell/AppShell.tsx.
 */
export default function AppShell(props: Props) {
  return (
    <div class="app-shell">
      <a href="#main" class="skip-link">本文へスキップ</a>
      <Sidebar />
      <div class="app-shell-main">
        <TopBar />
        <main class="app-shell-content" id="main" tabindex="-1">
          {props.children}
        </main>
      </div>
      <MobileTabs />
    </div>
  );
}
