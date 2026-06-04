import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { LogOut, Settings } from "lucide-solid";
import {
  clearSession,
  readSession,
  type SessionRecord,
} from "../../lib/session.ts";

/**
 * Avatar pill in TopBar that pops a small menu with the signed-in user
 * info and a sign-out button.
 *
 * Ported from takosumi dashboard-ui/src/components/auth/UserMenu.tsx.
 */
export default function UserMenu() {
  const [open, setOpen] = createSignal(false);
  const [session, setSession] = createSignal<SessionRecord | null>(null);
  const nav = useNavigate();
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    setSession(readSession());
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef) return;
      if (!containerRef.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  const initial = () => {
    const s = session();
    if (!s) return "?";
    return (s.displayName ?? s.email ?? s.subject ?? "?").charAt(0)
      .toUpperCase();
  };
  const label = () => {
    const s = session();
    if (!s) return "Anonymous";
    return s.displayName ?? s.email ?? s.subject;
  };

  const signOut = () => {
    clearSession();
    nav("/sign-in", { replace: true });
  };

  return (
    <div class="user-menu" ref={containerRef}>
      <button
        type="button"
        class="topbar-user"
        aria-label="ユーザーメニュー"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="topbar-avatar">{initial()}</span>
      </button>
      <Show when={open()}>
        <div class="user-menu-pop" role="menu">
          <div class="user-menu-id">
            <div class="user-menu-name">{label()}</div>
            <Show when={session()?.subject}>
              {(sub) => <div class="user-menu-sub">{sub()}</div>}
            </Show>
          </div>
          <a
            class="user-menu-item"
            href="/account"
            onClick={() => setOpen(false)}
          >
            <Settings size={16} /> 設定
          </a>
          <button
            class="user-menu-item user-menu-danger"
            type="button"
            onClick={signOut}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </Show>
    </div>
  );
}
