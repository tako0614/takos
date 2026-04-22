import { createMemo, Show } from "solid-js";
import { CreateSpaceModal } from "../../views/shared/spaces/CreateSpaceModal.tsx";
import { ChatSearchModal } from "../../views/chat/ChatSearchModal.tsx";
import { AgentModal } from "../../views/AgentModal.tsx";
import { useModals } from "../../store/modal.tsx";
import { useNavigation } from "../../store/navigation.ts";
import { useAuth } from "../../hooks/useAuth.tsx";
import { buildChatSearchNavigationState } from "./app-modal-state.ts";

interface AppModalsProps {
  onCreateSpace: (
    name: string,
    description: string,
    installDefaultApps: boolean,
  ) => Promise<void>;
}

export function AppModals(props: AppModalsProps) {
  const modal = useModals();
  const navigation = useNavigation();
  const auth = useAuth();
  const resolvedSpaceId = createMemo(() =>
    navigation.selectedSpaceId ?? navigation.preferredSpaceId
  );

  return (
    <>
      <Show when={modal.showCreateSpace}>
        <CreateSpaceModal
          onClose={() => modal.setShowCreateSpace(false)}
          onCreate={props.onCreateSpace}
        />
      </Show>

      <Show when={modal.showSearch && resolvedSpaceId()}>
        <ChatSearchModal
          spaceId={resolvedSpaceId()!}
          onSelectResult={(threadId, messageId) => {
            modal.setShowSearch(false);
            navigation.navigate(
              buildChatSearchNavigationState(
                resolvedSpaceId() ?? undefined,
                threadId,
                messageId,
              ),
            );
          }}
          onClose={() => modal.setShowSearch(false)}
        />
      </Show>

      <Show when={modal.showAgentModal && navigation.selectedSpaceId}>
        <AgentModal
          spaceId={navigation.selectedSpaceId!}
          spaces={auth.spaces}
          onClose={() => modal.setShowAgentModal(false)}
        />
      </Show>
    </>
  );
}
