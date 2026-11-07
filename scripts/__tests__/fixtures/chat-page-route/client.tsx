import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ChatPage } from "../../../../web/src/views/chat/ChatPage.tsx";
import type { Space } from "../../../../web/src/types/index.ts";

const spaces: Space[] = ["a", "b"].map((id) => ({
  id: `workspace-${id}`, slug: `space-${id}`, name: `Workspace ${id}`,
  description: null, is_default: false, security_posture: "standard",
  created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z",
}));
const [route, setRoute] = createSignal<{ spaceId: string; threadId?: string }>({
  spaceId: "space-a", threadId: "thread-a",
});
const events: string[] = [];
const dispose = render(() => <ChatPage
  spaces={spaces}
  initialSpaceId={route().spaceId}
  initialThreadId={route().threadId}
  onThreadChange={(id) => events.push(`thread:${id}`)}
  onNewThreadCreated={(_, thread) => events.push(`created:${thread.id}`)}
/>, document.getElementById("root")!);

Object.assign(globalThis, {
  chatRouteFixture: {
    setRoute,
    state: () => ({ route: route(), events: [...events] }),
    dispose,
  },
});
