import { createEffect, createSignal, on } from "solid-js";
import { SpaceSettingsSection } from "./SpaceSettingsSection.tsx";
import type { Space } from "../../types/index.ts";

interface SpaceSettingsPageProps {
  spaces: Space[];
  initialSpaceId: string | null;
  onSpaceDeleted?: () => void;
  onSpaceUpdated?: () => void;
}

export function SpaceSettingsPage(props: SpaceSettingsPageProps) {
  const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(
    props.initialSpaceId,
  );

  createEffect(on(
    () => props.initialSpaceId,
    (nextSpaceId) => {
      setSelectedSpaceId(nextSpaceId);
    },
  ));

  return (
    <div class="flex-1 overflow-y-auto">
      <SpaceSettingsSection
        spaces={props.spaces}
        selectedSpaceId={selectedSpaceId()}
        setSelectedSpaceId={setSelectedSpaceId}
        onSpaceDeleted={props.onSpaceDeleted}
        onSpaceUpdated={props.onSpaceUpdated}
      />
    </div>
  );
}
