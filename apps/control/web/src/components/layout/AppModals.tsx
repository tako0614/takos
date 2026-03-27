import React from 'react';
import { CreateSpaceModal } from '../../views/shared/spaces/CreateSpaceModal';
import { ChatSearchModal } from '../../views/chat/ChatSearchModal';
import { AgentModal } from '../../views/AgentModal';
import { useModals } from '../../contexts/ModalContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAuth } from '../../contexts/AuthContext';

interface AppModalsProps {
  onCreateSpace: (name: string, description: string) => Promise<void>;
}

export function AppModals({ onCreateSpace }: AppModalsProps) {
  const {
    showCreateSpace,
    setShowCreateSpace,
    showAgentModal,
    setShowAgentModal,
    showSearch,
    setShowSearch,
  } = useModals();

  const {
    navigate,
    selectedSpaceId,
    preferredSpaceId,
  } = useNavigation();

  const { spaces } = useAuth();

  return (
    <>
      {showCreateSpace && (
        <CreateSpaceModal
          onClose={() => setShowCreateSpace(false)}
          onCreate={onCreateSpace}
        />
      )}

      {showSearch && (selectedSpaceId ?? preferredSpaceId) && (
        <ChatSearchModal
          spaceId={(selectedSpaceId ?? preferredSpaceId)!}
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
