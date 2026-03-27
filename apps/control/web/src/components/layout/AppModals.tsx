import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { CreateSpaceModal } from '../../views/shared/spaces/CreateSpaceModal';
import { ChatSearchModal } from '../../views/chat/ChatSearchModal';
import { AgentModal } from '../../views/AgentModal';
import { showCreateSpaceAtom, showAgentModalAtom, showSearchAtom } from '../../store/modal';
import { useNavigation } from '../../store/navigation';
import { useAuth } from '../../hooks/useAuth';

interface AppModalsProps {
  onCreateSpace: (name: string, description: string) => Promise<void>;
}

export function AppModals({ onCreateSpace }: AppModalsProps) {
  const showCreateSpace = useAtomValue(showCreateSpaceAtom);
  const setShowCreateSpace = useSetAtom(showCreateSpaceAtom);
  const showAgentModal = useAtomValue(showAgentModalAtom);
  const setShowAgentModal = useSetAtom(showAgentModalAtom);
  const showSearch = useAtomValue(showSearchAtom);
  const setShowSearch = useSetAtom(showSearchAtom);

  const {
    navigate,
    selectedSpaceId,
    preferredSpaceId,
  } = useNavigation();

  const { spaces } = useAuth();
  const resolvedSpaceId = selectedSpaceId ?? preferredSpaceId;

  return (
    <>
      {showCreateSpace && (
        <CreateSpaceModal
          onClose={() => setShowCreateSpace(false)}
          onCreate={onCreateSpace}
        />
      )}

      {showSearch && resolvedSpaceId && (
        <ChatSearchModal
          spaceId={resolvedSpaceId}
          onSelectResult={(threadId) => {
            setShowSearch(false);
            navigate({
              view: 'chat',
              spaceId: selectedSpaceId ?? preferredSpaceId ?? undefined,
              threadId,
              runId: undefined,
              messageId: undefined,
            });
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showAgentModal && selectedSpaceId && (
        <AgentModal
          spaceId={selectedSpaceId}
          spaces={spaces}
          onClose={() => setShowAgentModal(false)}
        />
      )}
    </>
  );
}
