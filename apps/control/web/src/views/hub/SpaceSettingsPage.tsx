import { createSignal } from 'solid-js';
import { SpaceSettingsSection } from './SpaceSettingsSection';
import type { Space } from '../../types';

interface SpaceSettingsPageProps {
  spaces: Space[];
  initialSpaceId: string | null;
  onSpaceDeleted?: () => void;
  onSpaceUpdated?: () => void;
}

export function SpaceSettingsPage({
  spaces,
  initialSpaceId,
  onSpaceDeleted,
  onSpaceUpdated,
}: SpaceSettingsPageProps) {
  const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(initialSpaceId);

  return (
    <div class="flex-1 overflow-y-auto">
      <SpaceSettingsSection
        spaces={spaces}
        selectedSpaceId={selectedSpaceId()}
        setSelectedSpaceId={setSelectedSpaceId}
        onSpaceDeleted={onSpaceDeleted}
        onSpaceUpdated={onSpaceUpdated}
      />
    </div>
  );
}
