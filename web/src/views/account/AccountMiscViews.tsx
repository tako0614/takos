import {
  createEffect,
  createSignal,
  type JSX,
  onMount,
  Show,
} from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import AppShell from "./components/shell/AppShell.tsx";
import Page from "./components/auth/Page.tsx";
import InkdropMark from "./components/brand/InkdropMark.tsx";
import { Icons } from "../../lib/Icons.tsx";
import {
  ApiError,
  type InstallationPlanRunResponse,
  rpc,
} from "./lib/api.ts";
import {
  readSession,
  refreshSession,
  type SessionRecord,
} from "./lib/session.ts";

/**
 * AccountMiscViews — the grab-bag of small/static account-plane screens ported
 * from the takosumi `dashboard-ui` package into the takos web SPA. They all talk
 * to the same-origin `/v1/*` account plane that is mounted in-process in
 * `takos/src/worker/web.ts` (single-operator, single-worker, bare-origin
 * issuer). Bundled into one file so a single agent owns these last, highest-
 * uncertainty screens.
 *
 * Named exports:
 *  - InstallWizard / InstallByUrlView / AppsInstallView — install-by-URL
 *  - SignInView / SignInCallbackView / SignInPanel       — upstream OAuth sign-in
 *  - TakosStartView                                       — Takos product launch
 *  - HomeView / NotificationsView / AccountIndexView      — landing / placeholders
 *
 * Titles are set via `document.title` (the takos SPA does not depend on
 * `@solidjs/meta`); icons use the local `Icons` set rather than `lucide-solid`.
 */

/** Set the document title to the takosumi-account-plane pattern. */
function useDocumentTitle(title: string): void {
  onMount(() => {
    if (typeof document !== "undefined") {
      document.title = `${title} — Takosumi`;
    }
  });
}

// ===========================================================================
// Install wizard (install-by-URL)
// ===========================================================================

// NOTE (simplify): `dedicated` / `self-hosted` reflect the dead multi-mode
// world. In the single-operator merged deployment everything is one cell, so
// the mode picker is functionally a no-op kept for wire-compat. A follow-up
// should collapse this to `shared-cell` only and drop the <select>.
type Mode = "shared-cell" | "dedicated" | "self-hosted";

/**
 * The install-by-URL wizard. Shared by the canonical `/install` route and the
 * in-dashboard `/apps/install` route. Pre-fills from URL query
 * (?git=...&ref=...&mode=...&space=...&account=...&autoplan=1) so product
 * landing pages can deep-link straight into install with the source already
 * filled in, and `autoplan=1` runs the PlanRun on mount.
 *
 * API: POST /v1/installations/plan-runs (PlanRun), POST /v1/installations.
 */
export function InstallWizard() {
  const nav = useNavigate();
  const [params] = useSearchParams<{
    git?: string;
    ref?: string;
    mode?: string;
    space?: string;
    account?: string;
    autoplan?: string;
  }>();

  const [gitUrl, setGitUrl] = createSignal(params.git ?? "");
  const [ref, setRef] = createSignal(params.ref ?? "main");
  const initialMode: Mode =
    params.mode === "dedicated" || params.mode === "self-hosted"
      ? params.mode
      : "shared-cell";
  const [mode, setMode] = createSignal<Mode>(initialMode);
  // New-user one-click install: fall back to the session's primary account and
  // a freshly generated space so `autoplan` can fire and Plan/Install enable
  // even for a cold visitor who has no account/space yet. Fields stay editable
  // for users targeting an existing account/space (their last-used ids are
  // restored from localStorage).
  const [spaceId, setSpaceId] = createSignal(
    params.space ?? storedValue("tg_apps_space_id") ?? generatedId("space"),
  );
  const [accountId, setAccountId] = createSignal(
    params.account ?? storedValue("tg_apps_account_id") ??
      readSession()?.primaryAccountId ?? generatedId("acct"),
  );

  const [planRun, setPlanRun] = createSignal<
    InstallationPlanRunResponse | null
  >(null);
  const [planRunning, setPlanRunning] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [autoPlanFired, setAutoPlanFired] = createSignal(false);

  const runPlanRun = async (e?: Event) => {
    e?.preventDefault();
    setErr(null);
    setPlanRun(null);
    setPlanRunning(true);
    try {
      const result = await rpc.installations.plan({
        gitUrl: gitUrl(),
        ref: ref(),
        spaceId: spaceId(),
      });
      setPlanRun(result);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setPlanRunning(false);
    }
  };

  // ?autoplan=1 with a git URL runs PlanRun once on mount.
  createEffect(() => {
    if (
      params.autoplan === "1" &&
      gitUrl() &&
      spaceId() &&
      !autoPlanFired() &&
      !planRunning() &&
      !planRun()
    ) {
      setAutoPlanFired(true);
      void runPlanRun();
    }
  });

  const runInstall = async () => {
    setErr(null);
    const p = planRun();
    if (!p) {
      setErr("先に PlanRun を実行してください。");
      return;
    }
    const session = readSession();
    if (!session) {
      setErr("session が見つかりません。 再ログインしてください。");
      return;
    }
    const appId = pickString(p, [
      "repo.id",
      "source.repositoryUrl",
      "source.url",
    ]);
    const commit = pickString(p, ["expected.sourceCommit", "source.commit"]);
    const planDigest = pickString(p, ["expected.planDigest", "planDigest"]);
    if (!appId || !commit || !planDigest) {
      setErr(
        "Plan の結果を install に使用できませんでした。時間をおいて再度お試しください。",
      );
      return;
    }
    setInstalling(true);
    try {
      const created = await rpc.installations.create({
        accountId: accountId(),
        spaceId: spaceId(),
        appId,
        source: {
          gitUrl: gitUrl(),
          ref: ref(),
          commit,
          planDigest,
        },
        mode: mode(),
        createdBySubject: session.subject,
      });
      localStorage.setItem("tg_apps_account_id", accountId());
      localStorage.setItem("tg_apps_space_id", spaceId());
      nav(`/apps/${encodeURIComponent(created.installationId)}`);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <AppShell>
      <div class="page-header">
        <h1>App を install</h1>
        <p class="page-sub">
          Git リポジトリから takosumi 上に app を install します。
        </p>
      </div>

      <section class="detail-section">
        <h2>Source</h2>
        <form class="install-form" onSubmit={runPlanRun}>
          <label>
            Git URL
            <input
              type="url"
              value={gitUrl()}
              onInput={(e) => setGitUrl(e.currentTarget.value)}
              placeholder="https://github.com/owner/repo.git"
              required
            />
          </label>
          <label>
            Ref
            <input
              type="text"
              value={ref()}
              onInput={(e) => setRef(e.currentTarget.value)}
              placeholder="main"
              required
            />
          </label>
          <button
            class="btn btn-secondary"
            type="submit"
            disabled={planRunning() || !gitUrl() || !spaceId()}
          >
            <Icons.GitBranch class="w-4 h-4" /> {planRunning()
              ? "Plan 中..."
              : "Plan"}
          </button>
        </form>
      </section>

      <Show when={planRun()}>
        {(p) => (
          <section class="detail-section">
            <h2>Plan 結果</h2>
            <dl class="kv-list">
              <dt>App ID</dt>
              <dd>
                {pickString(p(), [
                  "repo.id",
                  "source.repositoryUrl",
                  "source.url",
                ]) ?? "—"}
              </dd>
              <dt>Commit</dt>
              <dd>
                <code>
                  {pickString(p(), ["source.commit", "expected.sourceCommit"]) ??
                    "—"}
                </code>
              </dd>
              <dt>Plan digest</dt>
              <dd>
                <code>{pickString(p(), ["planDigest"]) ?? "—"}</code>
              </dd>
              <dt>Expected plan digest</dt>
              <dd>
                <code>{pickString(p(), ["expected.planDigest"]) ?? "—"}</code>
              </dd>
            </dl>
          </section>
        )}
      </Show>

      <section class="detail-section">
        <h2>Target</h2>
        <div class="install-grid">
          <label>
            Account ID
            <input
              type="text"
              value={accountId()}
              onInput={(e) => setAccountId(e.currentTarget.value)}
              placeholder="acct_xxxxx"
            />
          </label>
          <label>
            Space ID
            <input
              type="text"
              value={spaceId()}
              onInput={(e) => setSpaceId(e.currentTarget.value)}
              placeholder="space_xxxxx"
            />
          </label>
          <label>
            Mode
            <select
              value={mode()}
              onChange={(e) => setMode(e.currentTarget.value as Mode)}
            >
              <option value="shared-cell">shared-cell</option>
              <option value="dedicated">dedicated</option>
              <option value="self-hosted">self-hosted</option>
            </select>
          </label>
        </div>
      </section>

      <Show when={err()}>{(m) => <p class="sign-in-error">{m()}</p>}</Show>

      <section class="detail-section">
        <button
          class="btn btn-primary"
          type="button"
          onClick={runInstall}
          disabled={installing() || !planRun() || !accountId() || !spaceId()}
        >
          <Icons.Server class="w-4 h-4" /> {installing()
            ? "Install 中..."
            : "Install"}
        </button>
        <a href="/apps" class="btn btn-secondary" style="margin-left: 8px;">
          キャンセル
        </a>
        <p class="muted" style="margin-top: 12px;">
          Install 先の account と space を確認してから実行してください。
        </p>
      </section>
    </AppShell>
  );
}

/**
 * Canonical install-by-URL entry. The official, advertised way to install any
 * OpenTofu-module repo: open `/install?git=<repo>&ref=<ref>&mode=<mode>&autoplan=1`
 * and the wizard pre-fills + runs the PlanRun.
 */
export function InstallByUrlView() {
  return <Page title="Install">{() => <InstallWizard />}</Page>;
}

/**
 * In-dashboard install entry (the "+ Install" button). Renders the same wizard
 * as the canonical `/install` route. Kept so existing `/apps/install`
 * links/bookmarks keep working.
 */
export function AppsInstallView() {
  return <Page title="Install app">{() => <InstallWizard />}</Page>;
}

// ===========================================================================
// Sign-in (upstream OAuth) + OAuth callback
// ===========================================================================

// CAVEAT (reconcile): in the single-operator merged world the bare-origin
// issuer means the takos product already has its own login flow
// (`views/app/AuthViews.tsx` LoginPage + `hooks/useAuth.tsx`) that drives the
// in-worker OIDC consumer. This SignInPanel is the account-plane's OWN sign-in
// (cookie session via `./lib/session.ts`, distinct from takos `useAuth`). For
// the merged deployment the router agent should decide whether to:
//   (a) route `/sign-in` here (account-plane cookie session), or
//   (b) redirect `/sign-in` to the existing takos LoginPage and drop this panel.
// Ported functionally so option (a) works out of the box; flagged for
// simplification. The dashboard-ui dev-sign-in shortcut is intentionally NOT
// ported (it wrote a fake session and is not part of the shared plan).

type Provider = "passkey" | "google" | "github";

interface ProviderInfo {
  id: Provider;
  label: string;
  sub: string;
  enabled: boolean;
  icon: () => JSX.Element;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "passkey",
    label: "Passkey で続ける",
    sub: "このアカウントではまだ利用できません",
    enabled: false,
    icon: () => (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        <circle cx="12" cy="16" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "google",
    label: "Google で続ける",
    sub: "OAuth 2.0",
    enabled: true,
    icon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.3-1 2.4-2 3.1v2.6h3.3c2-1.8 3-4.5 3-7.5z" />
        <path d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H3v2.6C4.7 19.7 8.1 22 12 22z" />
        <path d="M6.3 13.8c-.2-.6-.3-1.2-.3-1.8s.1-1.2.3-1.8V7.6H3C2.4 8.9 2 10.4 2 12s.4 3.1 1 4.4l3.3-2.6z" />
        <path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.7 4.3 3 7.6l3.3 2.6c.8-2.4 3.1-4.3 5.7-4.3z" />
      </svg>
    ),
  },
  {
    id: "github",
    label: "GitHub で続ける",
    sub: "OAuth 2.0",
    enabled: true,
    icon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.07.78 2.15v3.18c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
      </svg>
    ),
  },
];

/**
 * Account-plane sign-in panel. Navigation-based upstream OAuth (Google/GitHub);
 * passkey is a placeholder. See the reconcile CAVEAT above before wiring routes.
 */
export function SignInPanel() {
  const [error, setError] = createSignal<string | null>(null);

  const select = (p: Provider) => {
    setError(null);
    if (p === "passkey") {
      setError("Passkey sign-in は、このアカウントではまだ利用できません。");
      return;
    }
    rpc.auth.startUpstreamOAuth(p);
  };

  return (
    <div class="sign-in-panel">
      <h1 class="sign-in-title">サインイン</h1>
      <p class="sign-in-sub">Takosumi のアカウントで続けます。</p>
      <div class="sign-in-buttons">
        {PROVIDERS.map((p) => (
          <button
            type="button"
            class="sign-in-btn"
            data-provider={p.id}
            disabled={!p.enabled}
            onClick={() => select(p.id)}
          >
            <span class="sign-in-icon">{p.icon()}</span>
            <span class="sign-in-text">
              <span class="sign-in-label">{p.label}</span>
              <span class="sign-in-sub-text">{p.sub}</span>
            </span>
            <svg
              class="sign-in-arrow"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ))}
      </div>
      <Show when={error()}>
        {(msg) => (
          <p class="sign-in-error" role="alert">
            {msg()}
          </p>
        )}
      </Show>
      <p class="sign-in-terms">
        続行することで{" "}
        <a
          href="https://docs.takos.jp/legal/terms-of-service"
          class="link"
          target="_blank"
          rel="noopener"
        >
          利用規約
        </a>{" "}
        と
        <a
          href="https://docs.takos.jp/legal/privacy-policy"
          class="link"
          target="_blank"
          rel="noopener"
        >
          プライバシーポリシー
        </a>{" "}
        に同意したものとみなします。
      </p>
    </div>
  );
}

/** Sign-in page wrapper (brand + panel). */
export function SignInView() {
  useDocumentTitle("サインイン");
  return (
    <div class="auth-page">
      <a href="/" class="auth-brand">
        <InkdropMark size={32} />
        <span class="auth-brand-text">Takosumi</span>
      </a>
      <SignInPanel />
    </div>
  );
}

/**
 * OAuth callback handler. Completes the upstream OAuth round-trip, refreshes the
 * cookie session, then navigates to the preserved return path.
 *
 * API: GET /v1/auth/upstream/callback (via rpc.auth.completeUpstreamOAuth).
 */
export function SignInCallbackView() {
  useDocumentTitle("サインイン処理中...");
  const nav = useNavigate();
  const [params] = useSearchParams<{
    code?: string;
    state?: string;
    provider?: string;
  }>();
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    const code = params.code;
    const state = params.state;
    // Upstream providers don't pass `provider` back in the URL — recall it
    // from sessionStorage (stashed by startUpstreamOAuth) and fall back to the
    // URL only if the SPA initiated the flow via a deep link.
    const provider = (params.provider as "google" | "github" | undefined) ??
      rpc.auth.recallOAuthProvider() ?? undefined;
    if (typeof code !== "string" || typeof state !== "string" || !provider) {
      setError(
        "OAuth response が不完全です (code / state / provider のいずれかが欠落)。 再度 sign-in を試してください。",
      );
      return;
    }
    rpc.auth.completeUpstreamOAuth(code, state, provider)
      .then(async ({ returnTo }: { returnTo: string }) => {
        // Populate the session cache from the just-set HttpOnly cookie BEFORE
        // we navigate; otherwise the next route's AuthGuard runs before the
        // /me roundtrip resolves and bounces back to /sign-in.
        await refreshSession();
        nav(returnTo, { replace: true });
      })
      .catch((err: Error) => setError(err.message));
  });

  return (
    <div class="auth-page">
      <Show
        when={!error()}
        fallback={
          <div class="sign-in-panel">
            <h1 class="sign-in-title">サインインに失敗しました</h1>
            <p class="sign-in-error" role="alert">{error()}</p>
            <a
              href="/sign-in"
              class="btn btn-secondary"
              style="margin-top: 24px;"
            >
              サインインへ戻る
            </a>
          </div>
        }
      >
        <p class="auth-spinner">サインイン処理中...</p>
      </Show>
    </div>
  );
}

// ===========================================================================
// Takos start (product launch)
// ===========================================================================

const DEFAULT_USE_TAKOS_TERMS_VERSION = "terms-2026-05-13";

interface UseTakosStartUrlInput {
  readonly origin: string;
  readonly takosUrl: string;
  readonly subject: string;
  readonly accountId: string;
  readonly spaceId: string;
  readonly installationId?: string;
  readonly appId?: string;
  readonly termsVersion?: string;
  readonly returnTo?: string;
}

/**
 * Resolve the default Takos product URL for the current host. On a local
 * substrate hostname we point at `https://takos.test`; otherwise it can be set
 * via the build-time `VITE_TAKOSUMI_DASHBOARD_TAKOS_URL`. Returns `undefined`
 * when nothing is configured (the form then requires the user to type it).
 *
 * NOTE (simplify): in the single-operator merged world the Takos product URL is
 * the same origin family as the account plane; a follow-up can hardcode this
 * instead of reading per-distribution env.
 */
function tryDefaultTakosUrlForHost(hostname: string): string | undefined {
  if (isLocalHost(hostname)) return "https://takos.test";
  const configured =
    (import.meta.env.VITE_TAKOSUMI_DASHBOARD_TAKOS_URL as string | undefined)
      ?.trim();
  if (configured) return configured;
  return undefined;
}

function isLocalHost(hostname: string): boolean {
  return hostname.endsWith(".test") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";
}

function safeReturnTo(value: string | undefined, spaceId: string): string {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return `/spaces/${spaceId}/threads`;
}

function buildUseTakosStartUrl(input: UseTakosStartUrlInput): string {
  const url = new URL("/start", input.origin);
  url.searchParams.set("takos_url", input.takosUrl);
  url.searchParams.set("subject", input.subject);
  url.searchParams.set("account_id", input.accountId);
  url.searchParams.set("space_id", input.spaceId);
  if (input.installationId) {
    url.searchParams.set("installation_id", input.installationId);
  }
  if (input.appId) {
    url.searchParams.set("app_id", input.appId);
  }
  url.searchParams.set(
    "terms_version",
    input.termsVersion ?? DEFAULT_USE_TAKOS_TERMS_VERSION,
  );
  url.searchParams.set("terms_accepted", "true");
  url.searchParams.set("return_to", safeReturnTo(input.returnTo, input.spaceId));
  return url.toString();
}

/**
 * Takos product launch screen. Confirms account / space / terms, then redirects
 * to the `/start` launch URL. `use-takos-start` ports here as a local helper.
 */
export function TakosStartView() {
  useDocumentTitle("Start Takos");
  return (
    <Page>
      {(session: SessionRecord) => <TakosStartInner subject={session.subject} />}
    </Page>
  );
}

function TakosStartInner(props: { subject: string }) {
  const [params] = useSearchParams<{
    takos_url?: string;
    takosUrl?: string;
    account_id?: string;
    accountId?: string;
    space_id?: string;
    spaceId?: string;
    installation_id?: string;
    installationId?: string;
    app_id?: string;
    appId?: string;
    terms_version?: string;
    termsVersion?: string;
    return_to?: string;
    returnTo?: string;
  }>();
  const host = typeof location === "undefined" ? "" : location.hostname;
  const origin = typeof location === "undefined"
    ? "https://accounts.takosumi.com"
    : location.origin;
  const storage = typeof localStorage === "undefined" ? undefined : localStorage;

  const [takosUrl, setTakosUrl] = createSignal(
    params.takos_url ?? params.takosUrl ?? tryDefaultTakosUrlForHost(host) ?? "",
  );
  const [accountId, setAccountId] = createSignal(
    params.account_id ?? params.accountId ??
      storage?.getItem("tg_apps_account_id") ?? "",
  );
  const [spaceId, setSpaceId] = createSignal(
    params.space_id ?? params.spaceId ??
      storage?.getItem("tg_apps_space_id") ?? "",
  );
  const [termsVersion, setTermsVersion] = createSignal(
    params.terms_version ?? params.termsVersion ??
      DEFAULT_USE_TAKOS_TERMS_VERSION,
  );
  const [termsAccepted, setTermsAccepted] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const submit = (event: Event) => {
    event.preventDefault();
    setErr(null);
    if (!accountId() || !spaceId()) {
      setErr("Account ID と Space ID を入力してください。");
      return;
    }
    if (!termsAccepted()) {
      setErr("利用規約への同意が必要です。");
      return;
    }
    storage?.setItem("tg_apps_account_id", accountId());
    storage?.setItem("tg_apps_space_id", spaceId());
    location.assign(buildUseTakosStartUrl({
      origin,
      takosUrl: takosUrl(),
      subject: props.subject,
      accountId: accountId(),
      spaceId: spaceId(),
      installationId: params.installation_id ?? params.installationId,
      appId: params.app_id ?? params.appId,
      termsVersion: termsVersion(),
      returnTo: params.return_to ?? params.returnTo,
    }));
  };

  return (
    <AppShell>
      <div class="page-header">
        <h1>Use Takos</h1>
        <p class="page-sub">
          Account と Space を確認して、Takos を開始します。
        </p>
      </div>

      <form onSubmit={submit}>
        <section class="detail-section">
          <h2>Takos launch</h2>
          <div class="install-grid">
            <label>
              Takos URL
              <input
                type="url"
                value={takosUrl()}
                onInput={(e) => setTakosUrl(e.currentTarget.value)}
                required
              />
            </label>
            <label>
              Terms version
              <input
                type="text"
                value={termsVersion()}
                onInput={(e) => setTermsVersion(e.currentTarget.value)}
                required
              />
            </label>
          </div>
        </section>

        <section class="detail-section">
          <h2>Account and Space</h2>
          <div class="install-grid">
            <label>
              Account ID
              <input
                type="text"
                value={accountId()}
                onInput={(e) => setAccountId(e.currentTarget.value)}
                placeholder="acct_xxxxx"
                required
              />
            </label>
            <label>
              Space ID
              <input
                type="text"
                value={spaceId()}
                onInput={(e) => setSpaceId(e.currentTarget.value)}
                placeholder="space_xxxxx"
                required
              />
            </label>
          </div>
        </section>

        <section class="detail-section">
          <h2>Terms</h2>
          <label class="check">
            <input
              type="checkbox"
              checked={termsAccepted()}
              onChange={(e) => setTermsAccepted(e.currentTarget.checked)}
            />
            <span>Takosumi の利用規約に同意します。</span>
          </label>
          <Show when={err()}>
            {(m) => <p class="sign-in-error" role="alert">{m()}</p>}
          </Show>
          <button
            class="btn btn-primary"
            type="submit"
            disabled={!accountId() || !spaceId() || !takosUrl() ||
              !termsAccepted()}
          >
            <Icons.Play class="w-4 h-4" /> Launch Takos
          </button>
        </section>
      </form>
    </AppShell>
  );
}

// ===========================================================================
// Home / Notifications / index — read GET /v1/account/session/me only
// ===========================================================================

/** Account-plane landing for an authenticated user. */
export function HomeView() {
  return (
    <Page title="Home">
      {(session: SessionRecord) => (
        <AppShell>
          <div class="page-header">
            <h1>Welcome back.</h1>
            <p class="page-sub">
              <SignedInAs
                name={session.displayName}
                sub={session.subject}
                email={session.email}
              />
            </p>
          </div>
          <section class="empty-state">
            <p>まだ何も installed されていません。</p>
            <a href="/install" class="btn btn-primary">
              最初のアプリを install →
            </a>
          </section>
        </AppShell>
      )}
    </Page>
  );
}

function SignedInAs(props: { name?: string; sub: string; email?: string }) {
  if (props.name) return <>Signed in as {props.name} ({props.sub})</>;
  if (props.email) return <>Signed in as {props.email} ({props.sub})</>;
  return <>Signed in as {props.sub}</>;
}

/** Notifications placeholder (delivery not yet implemented on this plane). */
export function NotificationsView() {
  return (
    <Page title="Notifications">
      {() => (
        <AppShell>
          <div class="page-header">
            <h1>Notifications</h1>
            <p class="page-sub">
              billing アラート / app install イベント / invite の通知。
            </p>
          </div>
          <section class="empty-state">
            <Icons.Bell class="w-8 h-8" aria-hidden="true" />
            <p>通知はまだ利用できません (coming soon)。</p>
            <p class="muted">
              billing アラート / app install イベント / invite
              の通知配信は、このアカウントプレーンではまだ実装されていません。
            </p>
          </section>
        </AppShell>
      )}
    </Page>
  );
}

/**
 * Account-plane index. No marketing landing on the account plane — probe the
 * server-side session via /v1/account/session/me (the cookie is HttpOnly and
 * cannot be read from JS) and send the visitor to /home or /sign-in.
 */
export function AccountIndexView() {
  const nav = useNavigate();

  onMount(() => {
    void refreshSession().then((session: SessionRecord | null) => {
      nav(session ? "/home" : "/sign-in", { replace: true });
    });
  });

  return (
    <div class="auth-page">
      <p class="auth-spinner">読み込み中...</p>
    </div>
  );
}

// ===========================================================================
// Local helpers (InstallWizard)
// ===========================================================================

function storedValue(key: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const value = localStorage.getItem(key);
  return value && value.length > 0 ? value : undefined;
}

function generatedId(prefix: "space" | "acct"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function pickString(
  obj: Record<string, unknown>,
  paths: string[],
): string | null {
  for (const p of paths) {
    const v = lookupPath(obj, p);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function lookupPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}
