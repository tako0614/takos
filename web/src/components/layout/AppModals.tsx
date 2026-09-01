import { createMemo, lazy, Show } from "solid-js";
import { ConfirmDialogRenderer } from "../common/ConfirmDialog.tsx";
import { useAuth } from "../../hooks/useAuth.tsx";
import { getErrorMessage } from "../../lib/errors.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import {
  findSpaceByIdentifier,
  getSpaceIdentifier,
} from "../../lib/spaces.ts";
import { parseWorkspaceMutationResponseFor } from "../../lib/space-response.ts";
import { useModals } from "../../store/modal.tsx";
import { useNavigation } from "../../store/navigation.ts";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import type { Space } from "../../types/index.ts";
import { buildChatSearchNavigationState } from "./app-modal-state.ts";

const CreateSpaceModal = lazy(() =>
  import("../../views/shared/spaces/CreateSpaceModal.tsx").then((module) => ({
    default: module.CreateSpaceModal,
  })),
);
const ChatSearchModal = lazy(() =>
  import("../../views/chat/ChatSearchModal.tsx").then((module) => ({
    default: module.ChatSearchModal,
  })),
);
const AgentModal = lazy(() =>
  import("../../views/AgentModal.tsx").then((module) => ({
    default: module.AgentModal,
  })),
);

export function AppModals() {
  const auth = useAuth();
  const i18n = useI18n();
  const modal = useModals();
  const navigation = useNavigation();
  const { showToast } = useToast();
  const selectedSearchSpace = createMemo(() => {
    const spaceId = navigation.selectedSpaceId ?? navigation.preferredSpaceId;
    return spaceId ? findSpaceByIdentifier(auth.spaces, spaceId) : null;
  });
  const selectedAgentSpace = createMemo(() => {
    const spaceId = navigation.selectedSpaceId;
    return spaceId ? findSpaceByIdentifier(auth.spaces, spaceId) : null;
  });

  const handleCreateSpace = async (
    name: string,
    description: string,
    installFeaturedApps: boolean,
    operationId: string,
  ) => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    let space: Space;

    try {
      const response = await rpc.spaces.$post({
        json: {
          name: trimmedName,
          description: trimmedDescription || undefined,
          installFeaturedApps,
          idempotency_key: operationId,
        },
      });
      space = parseWorkspaceMutationResponseFor(
        await rpcJson<unknown>(response),
        {
          isDefault: false,
          name: trimmedName,
          description: trimmedDescription || null,
        },
      );
    } catch (error) {
      throw new Error(
        getErrorMessage(error, i18n.t("failedToCreate")),
      );
    }

    let refreshed = true;
    try {
      await auth.fetchSpaces(auth.user, {
        notifyOnError: false,
        throwOnError: true,
      });
    } catch {
      refreshed = false;
    }

    modal.setShowCreateSpace(false);
    if (refreshed) {
      showToast("success", i18n.t("categoryCreated"));
      navigation.navigateToChat(getSpaceIdentifier(space));
    } else {
      showToast("error", i18n.t("workspaceCreatedRefreshFailed"));
    }
  };

  return (
    <>
      <Show when={modal.showCreateSpace}>
        <CreateSpaceModal
          onClose={() => modal.setShowCreateSpace(false)}
          onCreate={handleCreateSpace}
        />
      </Show>

      <Show when={modal.showSearch ? selectedSearchSpace() : null}>
        {(space) => (
          <ChatSearchModal
            spaceId={getSpaceIdentifier(space())}
            onSelectResult={async (threadId, messageId) => {
              navigation.navigate(
                buildChatSearchNavigationState(
                  getSpaceIdentifier(space()),
                  threadId,
                  messageId,
                ),
              );
              return true;
            }}
            onClose={() => modal.setShowSearch(false)}
          />
        )}
      </Show>

      <Show when={modal.showAgentModal ? selectedAgentSpace() : null}>
        {(space) => (
          <AgentModal
            spaceId={getSpaceIdentifier(space())}
            spaceRecordId={space().id}
            onClose={() => modal.setShowAgentModal(false)}
          />
        )}
      </Show>

      <ConfirmDialogRenderer />
    </>
  );
}
