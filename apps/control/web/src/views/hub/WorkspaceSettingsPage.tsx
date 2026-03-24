import { useState } from 'react';
import { WorkspaceSettingsSection } from './WorkspaceSettingsSection';
import type { Workspace } from '../../types';

interface WorkspaceSettingsPageProps {
  workspaces: Workspace[];
  initialWorkspaceId: string | null;
  onWorkspaceDeleted?: () => void;
  onWorkspaceUpdated?: () => void;
}

export function WorkspaceSettingsPage({
  workspaces,
  initialWorkspaceId,
  onWorkspaceDeleted,
  onWorkspaceUpdated,
}: WorkspaceSettingsPageProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(initialWorkspaceId);

  return (
    <div className="flex-1 overflow-y-auto">
      <WorkspaceSettingsSection
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        setSelectedWorkspaceId={setSelectedWorkspaceId}
        onWorkspaceDeleted={onWorkspaceDeleted}
        onWorkspaceUpdated={onWorkspaceUpdated}
      />
    </div>
  );
}
