import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { WelcomeView } from "../../../../web/src/views/app/space/WelcomeView.tsx";
import { createChatPageActions } from "../../../../web/src/views/chat/chat-page-actions.ts";
import { rpc } from "../../../../web/src/lib/rpc.ts";
import { useToast } from "../../../../web/src/store/toast.ts";
import { ConfirmDialogRenderer } from "../../../../web/src/components/common/ConfirmDialog.tsx";
import { useConfirmDialogActions } from "../../../../web/src/store/confirm-dialog.ts";
import type { Space } from "../../../../web/src/types/index.ts";

const spaces: Space[] = ["a", "b"].map((id) => ({
  id: `workspace-${id}`, slug: `space-${id}`, name: `Workspace ${id}`,
  description: null, is_default: false, security_posture: "standard",
  created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z",
}));
const [space, setSpace] = createSignal(spaces[0]);
const accepted: { spaceId: string; threadId: string; message: string; model: string; files: string[] }[] = [];
const toast = useToast();
const dialogs = useConfirmDialogActions();
const dispose = render(() => {
  const actions = createChatPageActions({
    spaceId: () => space().slug,
    threadId: () => undefined,
    selectedModel: () => "original-model",
    loadThread: (id) => rpc.threads[":id"].$get({ param: { id } }),
    createThread: (spaceId, message) => rpc.spaces[":spaceId"].threads.$post({
      param: { spaceId }, json: { title: message.slice(0, 60), locale: "en" },
    }),
    onCreated: ({ spaceId, thread, message, model, files }) => {
      accepted.push({ spaceId, threadId: thread.id, message, model, files: files?.map((file) => file.name) ?? [] });
    },
    onSearchSelected: () => { throw new Error("No search in Welcome fixture"); },
    onError: (error) => { toast.showToast("error", String(error)); },
  });
  return <><WelcomeView space={space()} onCreateThread={actions.handleCreateThread} /><ConfirmDialogRenderer /></>;
}, document.getElementById("root")!);

Object.assign(globalThis, {
  welcomeSubmissionFixture: {
    setSpace: (id: "a" | "b") => setSpace(spaces[id === "a" ? 0 : 1]),
    state: () => ({ accepted: [...accepted], toasts: toast.toasts.map(({ type, message }) => ({ type, message })) }),
    dispose() { dialogs.handleCancel(); dispose(); for (const item of toast.toasts) toast.dismissToast(item.id); },
  },
});
