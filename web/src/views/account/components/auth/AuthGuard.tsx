import { useLocation, useNavigate } from "@solidjs/router";
import {
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Switch,
} from "solid-js";
import {
  onSessionChange,
  refreshSession,
  type SessionRecord,
} from "../../lib/session.ts";

interface Props {
  children: (session: SessionRecord) => JSX.Element;
}

type AuthState = "loading" | "authenticated" | "unauthenticated";

/**
 * Wraps an account screen that requires a signed-in account-plane session.
 * While the session is being read on mount we render a small spinner (NOT
 * redirect, NOT render children) so the cookie roundtrip has a chance to
 * resolve. Only after the /v1/account/session/me probe resolves with `null`
 * do we redirect to /sign-in with the intended return path preserved in
 * `?return=`.
 *
 * Ported from takosumi dashboard-ui/src/components/auth/AuthGuard.tsx. Gates
 * on the account-plane cookie session, which is distinct from the takos
 * product `useAuth()` session.
 */
export default function AuthGuard(props: Props) {
  const [session, setSession] = createSignal<SessionRecord | null>(null);
  const [state, setState] = createSignal<AuthState>("loading");
  const nav = useNavigate();
  const loc = useLocation();

  const redirectToSignIn = (preserveReturn: boolean): void => {
    const target = preserveReturn
      ? "/sign-in?return=" + encodeURIComponent(loc.pathname + loc.search)
      : "/sign-in";
    nav(target, { replace: true });
  };

  onMount(() => {
    void refreshSession().then((s) => {
      setSession(s);
      if (s) {
        setState("authenticated");
        return;
      }
      setState("unauthenticated");
      redirectToSignIn(true);
    });
  });

  const off = onSessionChange((s) => {
    setSession(s);
    if (!s && state() !== "loading") {
      setState("unauthenticated");
      // Lost-session redirect: do NOT preserve the return path because
      // this is typically a sign-out, and bouncing the user back to
      // the gated page after sign-out is surprising.
      redirectToSignIn(false);
    } else if (s) {
      setState("authenticated");
    }
  });
  onCleanup(() => off());

  return (
    <Switch>
      <Match when={state() === "loading"}>
        <div class="auth-page">
          <p class="auth-spinner">読み込み中...</p>
        </div>
      </Match>
      <Match when={state() === "authenticated" && session()}>
        {(s) => props.children(s())}
      </Match>
    </Switch>
  );
}
