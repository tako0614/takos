import type { Resource } from '../../../types/index.ts';
import { ResourceDetail } from '../ResourceDetail.tsx';
import type { ResourceDetailTab } from '../worker-models.ts';
import {
  getResourceStatusBgClass,
  getResourceTypeIcon,
  getResourceTypeName,
} from '../utils/resourceUtils.tsx';

export interface ResourceDetailContainerProps {
  resource: Resource;
  tab: ResourceDetailTab;
  onBack: () => void;
  onTabChange: (tab: ResourceDetailTab) => void;
  onDeleteResource: (resource: Resource) => void;
}

export function ResourceDetailContainer({
  resource,
  tab,
  onBack,
  onTabChange,
  onDeleteResource,
}: ResourceDetailContainerProps) {
  return (
    <ResourceDetail
      resource={resource}
      tab={tab}
      onBack={onBack}
      onTabChange={onTabChange}
      getResourceTypeIcon={getResourceTypeIcon}
      getResourceTypeName={getResourceTypeName}
      getResourceStatusBgClass={getResourceStatusBgClass}
      onDeleteResource={() => onDeleteResource(resource)}
    />
  );
}
