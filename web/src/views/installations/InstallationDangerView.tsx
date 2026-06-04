import { useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal, Match, Switch } from "solid-js";
import AppShell from "../account/components/shell/AppShell.tsx";
import Page from "../account/components/auth/Page.tsx";
import AppDetailNav from "../account/components/AppDetailNav.tsx";
import { ApiError, rpc } from "../account/lib/api.ts";
import { ActionError, createAction } from "../account/lib/action.tsx";
import { Icons } from "../../lib/Icons.tsx";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";

export default function InstallationDangerView() {
  return <Page>{() => <Inner />}</Page>;
}

function Inner() {
  const params = useParams<{ id: string }>();
  const nav = useNavigate();
  const { confirm } = useConfirmDialog();
  const [app] = createResource(() => params.id, rpc.installations.get);
  const [typed, setTyped] = createSignal("");

  const uninstall = createAction(async (installationId: string) => {
    await rpc.installations.uninstall(installationId);
    nav("/installations");
  });

  const run = async () => {
    const a = app();
    if (!a) return;
    if (typed() !== a.appId) {
      uninstall.setError(`appId (${a.appId}) を正確に入力してください。`);
      return;
    }
    const ok = await confirm({
      title: "Uninstall",
      message:
        `本当に ${a.installationId} を uninstall しますか？ この操作は取り消せません。`,
      confirmText: "Uninstall",
      danger: true,
    });
    if (!ok) return;
    void uninstall.run(a.installationId);
  };

  return (
    <AppShell>
      <Switch>
        <Match when={app.loading}>
          <div class="skel-block tall" />
        </Match>
        <Match when={app.error}>
          <div class="page-header">
            <h1>取得に失敗しました</h1>
          </div>
          <p>{(app.error as ApiError).message}</p>
        </Match>
        <Match when={app()}>
          {(a) => (
            <>
              <div class="page-header">
                <h1>
                  {a().appId} <span class="page-sub-tag">danger zone</span>
                </h1>
                <p class="page-sub">
                  installation id: <code>{a().installationId}</code>
                </p>
              </div>
              <AppDetailNav installationId={a().installationId} />

              <section class="detail-section danger-zone">
                <h2>
                  <Icons.AlertTriangle style={{ width: "18px", height: "18px" }} />{" "}
                  Uninstall
                </h2>
                <p class="muted">
                  この installation を完全に削除します。 取り消せません。
                </p>
                <p class="muted">
                  続行するには appId (<code>{a().appId}</code>)
                  を正確に入力してください。
                </p>
                <div class="danger-form">
                  <input
                    type="text"
                    value={typed()}
                    onInput={(e) => setTyped(e.currentTarget.value)}
                    placeholder={a().appId}
                    autocomplete="off"
                  />
                  <button
                    class="btn btn-danger"
                    type="button"
                    onClick={() => void run()}
                    disabled={uninstall.busy() || typed() !== a().appId}
                  >
                    <Icons.Trash style={{ width: "16px", height: "16px" }} />{" "}
                    {uninstall.busy() ? "Uninstall 中..." : "Uninstall"}
                  </button>
                </div>
                <ActionError error={uninstall.error} />
              </section>
            </>
          )}
        </Match>
      </Switch>
    </AppShell>
  );
}
