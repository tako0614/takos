import {
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import AppShell from "../account/components/shell/AppShell.tsx";
import Page from "../account/components/auth/Page.tsx";
import AppCard from "../account/components/AppCard.tsx";
import { ApiError, rpc } from "../account/lib/api.ts";

// localStorage key preserved from the takosumi dashboard-ui port so a
// previously-selected space survives the migration into the takos SPA.
const STORAGE_KEY = "tg_apps_space_id";

/**
 * Apps list (Installations index).
 *
 * Ported from takosumi dashboard-ui `routes/apps/index.tsx`. A space-id picker
 * plus a grid of {@link AppCard}, listing the installed apps for the selected
 * space via `GET /v1/installations?space_id=<id>` (the same-origin account
 * plane mounted in-process). Ported as-is to avoid behaviour change; in the
 * single-operator world the manual picker may later be replaced by
 * `useAuth().spaces`.
 */
export default function InstallationsListView() {
  return <Page title="Apps">{() => <InstallationsListInner />}</Page>;
}

function InstallationsListInner() {
  const initial = typeof localStorage !== "undefined"
    ? (localStorage.getItem(STORAGE_KEY) ?? "")
    : "";
  const [spaceId, setSpaceId] = createSignal(initial);
  const [draft, setDraft] = createSignal(initial);

  const applySpace = (e: Event) => {
    e.preventDefault();
    const next = draft().trim();
    setSpaceId(next);
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  };

  const [apps] = createResource(
    () => (spaceId() ? spaceId() : null),
    rpc.installations.list,
  );

  const hasSpace = createMemo(() => !!spaceId());

  return (
    <AppShell>
      <div class="page-header">
        <h1>Apps</h1>
        <p class="page-sub">Space ごとの install 済みアプリを確認します。</p>
        <div class="page-actions">
          <a href="/install" class="btn btn-primary">
            + Install
          </a>
        </div>
      </div>

      <section class="space-picker">
        <form onSubmit={applySpace}>
          <label>
            Space ID
            <input
              type="text"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              placeholder="space_xxxxxx"
              autocomplete="off"
            />
          </label>
          <button class="btn btn-secondary" type="submit">
            表示
          </button>
        </form>
      </section>

      <Show
        when={hasSpace()}
        fallback={
          <section class="empty-state">
            <p>space を指定するとアプリ一覧を表示します。</p>
          </section>
        }
      >
        <Switch>
          <Match when={apps.loading}>
            <div class="grid-skel">
              <div class="skel-card" />
              <div class="skel-card" />
              <div class="skel-card" />
            </div>
          </Match>
          <Match when={apps.error}>
            <section class="empty-state error-state">
              <p>取得に失敗しました — {(apps.error as ApiError).message}</p>
            </section>
          </Match>
          <Match when={apps()}>
            {(list) => (
              <Show
                when={list().length > 0}
                fallback={
                  <section class="empty-state">
                    <p>この space にはまだ何も installed されていません。</p>
                    <a href="/install" class="btn btn-primary">
                      最初のアプリを install →
                    </a>
                  </section>
                }
              >
                <div class="apps-grid">
                  <For each={list()}>{(a) => <AppCard app={a} />}</For>
                </div>
              </Show>
            )}
          </Match>
        </Switch>
      </Show>
    </AppShell>
  );
}
