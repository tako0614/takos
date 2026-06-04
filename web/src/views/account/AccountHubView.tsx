import { LogOut, Monitor } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import AppShell from "./components/shell/AppShell.tsx";
import Page from "./components/auth/Page.tsx";
import { clearSession, type SessionRecord } from "./lib/session.ts";

/**
 * Account hub + Profile + Sessions — three closely-coupled read-only
 * account-plane screens folded from the takosumi dashboard SPA:
 *   - AccountHubView   (dashboard-ui/src/routes/account/index.tsx)
 *   - AccountProfileView (dashboard-ui/src/routes/account/profile.tsx)
 *   - AccountSessionsView (dashboard-ui/src/routes/account/sessions.tsx)
 *
 * All three exported from one file so each router pattern maps to one export
 * while only this file owns the screens. Each wraps the ported `Page`
 * (account-plane cookie-session gating via AuthGuard) + dashboard `AppShell`
 * chrome. Profile/Sessions render only the current session record; there is no
 * subject-scoped session-enumeration API, so the only network calls are the
 * session helper's GET /v1/account/session/me (via Page → AuthGuard) and the
 * sign-out DELETE /v1/account/session/me (via clearSession).
 */

/** /account — hub nav links to the per-area account screens. */
export function AccountHubView() {
  return (
    <Page title="Account">
      {() => (
        <AppShell>
          <div class="page-header">
            <h1>Account</h1>
            <p class="page-sub">
              プロフィール、 セキュリティ、 トークン、 サブスクリプション。
            </p>
          </div>
          <div class="account-nav">
            <a href="/account/profile">プロフィール</a>
            <a href="/account/security">セキュリティ (passkey / 接続)</a>
            <a href="/account/tokens">Personal access tokens</a>
            <a href="/account/billing">Billing</a>
            <a href="/account/sessions">Sessions</a>
          </div>
        </AppShell>
      )}
    </Page>
  );
}

/** /account/profile — current sign-in detail (read-only). */
export function AccountProfileView() {
  return (
    <Page title="プロフィール">
      {(session) => (
        <AppShell>
          <div class="page-header">
            <h1>プロフィール</h1>
            <p class="page-sub">現在のサインイン情報。</p>
          </div>
          <section class="detail-section">
            <dl class="kv-list">
              <dt>Subject</dt>
              <dd>
                <code>{session.subject}</code>
              </dd>
              <dt>Display name</dt>
              <dd>{session.displayName ?? "—"}</dd>
              <dt>Email</dt>
              <dd>{session.email ?? "—"}</dd>
              <dt>Provider</dt>
              <dd>{session.provider ?? "—"}</dd>
              <dt>Session expires</dt>
              <dd>{new Date(session.expiresAt).toLocaleString("ja-JP")}</dd>
            </dl>
          </section>
        </AppShell>
      )}
    </Page>
  );
}

/** /account/sessions — current browser session + sign-out. */
export function AccountSessionsView() {
  return (
    <Page title="Sessions">
      {(session) => <SessionsInner session={session} />}
    </Page>
  );
}

function SessionsInner(props: { session: SessionRecord }) {
  const nav = useNavigate();
  const [busy, setBusy] = createSignal(false);
  // In-app confirmation (replaces blocking native confirm()).
  const [confirming, setConfirming] = createSignal(false);

  const signOutThisBrowser = () => {
    setBusy(true);
    clearSession();
    nav("/sign-in");
  };

  return (
    <AppShell>
      <div class="page-header">
        <h1>Sessions</h1>
        <p class="page-sub">アクティブなブラウザセッションの管理。</p>
      </div>

      <section class="detail-section">
        <h2>
          <Monitor size={18} /> 現在のセッション
        </h2>
        <dl class="kv-list">
          <dt>Session ID</dt>
          <dd>
            <code>{props.session.sessionId}</code>
          </dd>
          <dt>Subject</dt>
          <dd>
            <code>{props.session.subject}</code>
          </dd>
          <dt>Provider</dt>
          <dd>{props.session.provider ?? "—"}</dd>
          <dt>Expires</dt>
          <dd>{new Date(props.session.expiresAt).toLocaleString("ja-JP")}</dd>
          <dt>User-Agent</dt>
          <dd class="muted">{navigator.userAgent}</dd>
        </dl>
        <Show
          when={confirming()}
          fallback={
            <button
              class="btn btn-danger"
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy()}
              style="margin-top: 16px;"
            >
              <LogOut size={16} /> このブラウザからサインアウト
            </button>
          }
        >
          <div class="revoke-confirm" style="margin-top: 16px;">
            <span class="muted">このブラウザからサインアウトしますか？</span>
            <button
              class="btn btn-danger btn-sm"
              type="button"
              onClick={signOutThisBrowser}
              disabled={busy()}
            >
              <LogOut size={14} /> サインアウト
            </button>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy()}
            >
              取消
            </button>
          </div>
        </Show>
      </section>

      <section class="detail-section">
        <h2>他デバイスのセッション</h2>
        <p class="muted">
          他デバイスのセッション一覧とリモートサインアウト (coming soon):
          現在この account-plane は subject ごとのセッション列挙 API
          を持たないため、ここで管理できるのは上記の現在のブラウザのみです。
        </p>
      </section>
    </AppShell>
  );
}
