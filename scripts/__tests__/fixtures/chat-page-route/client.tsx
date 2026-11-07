import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ChatPage } from "../../../../web/src/views/chat/ChatPage.tsx";
import type { Space } from "../../../../web/src/types/index.ts";
import { useToast } from "../../../../web/src/store/toast.ts";

const spaces: Space[] = ["a", "b"].map((id) => ({
  id: `workspace-${id}`, slug: `space-${id}`, name: `Workspace ${id}`,
  description: null, is_default: false, security_posture: "standard",
  created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z",
}));
type Route = { spaceId: string; threadId?: string; messageId?: string };
const config = (globalThis as typeof globalThis & { chatRouteConfig?: Route }).chatRouteConfig;
const [route, setRoute] = createSignal<Route>(config ?? {
  spaceId: "space-a", threadId: "thread-a",
});
const events: string[] = [];
const toast = useToast();
const dispose = render(() => <ChatPage
  spaces={spaces}
  initialSpaceId={route().spaceId}
  initialThreadId={route().threadId}
  initialMessageId={route().messageId}
  onThreadChange={(id) => events.push(`thread:${id}`)}
  onNewThreadCreated={(_, thread) => events.push(`created:${thread.id}`)}
/>, document.getElementById("root")!);

Object.assign(globalThis, {
  chatRouteFixture: {
    setRoute,
    state: () => ({ route: route(), events: [...events] }),
    toasts: () => toast.toasts.map(({ type, message }) => ({ type, message })),
    dispose() { dispose(); for (const item of toast.toasts) toast.dismissToast(item.id); },
  },
});
