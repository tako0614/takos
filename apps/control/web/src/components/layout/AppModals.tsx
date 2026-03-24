import React from 'react';
import { CreateWorkspaceModal } from '../../views/shared/workspaces/CreateWorkspaceModal';
import { ChatSearchModal } from '../../views/chat/ChatSearchModal';
import { AgentModal } from '../../views/AgentModal';
import { useModals } from '../../contexts/ModalContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAuth } from '../../contexts/AuthContext';

interface AppModalsProps {
  onCreateWorkspace: (name: string, description: string) => Promise<void>;
}

export function AppModals({ onCreateWorkspace }: AppModalsProps) {
  const {
    showCreateWorkspace,
    setShowCreateWorkspace,
    showAgentModal,
    setShowAgentModal,
    showSearch,
    setShowSearch,
  } = useModals();

  const {
    navigate,
    selectedWorkspaceId,
    preferredWorkspaceId,
  } = useNavigation();

  const { workspaces } = useAuth();

  return (
    <>
      {showCreateWorkspace && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWorkspace(false)}
          onCreate={onCreateWorkspace}
        />
      )}

      {showSearch && (selectedWorkspaceId ?? preferredWorkspaceId) && (
        <ChatSearchModal
          spaceId={(selectedWorkspaceId ?? preferredWorkspaceId)!}
          onSelectResult={(threadId) => {
            setShowSearch(false);
            navigate({
              view: 'chat',
              spaceId: selectedWorkspaceId ?? preferredWorkspaceId ?? undefined,
              threadId,
              runId: undefined,
              messageId: undefined,
            });
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showAgentModal && selectedWorkspaceId && (
        <AgentModal
          spaceId={selectedWorkspaceId}
          workspaces={workspaces}
          onClose={() => setShowAgentModal(false)}
        />
      )}
    </>
  );
}
