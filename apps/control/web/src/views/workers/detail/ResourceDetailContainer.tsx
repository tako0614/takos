import type { Resource } from '../../../types';
import { ResourceDetail } from '../ResourceDetail';
import type { ResourceDetailTab } from '../types';
import {
  getResourceStatusBgClass,
  getResourceTypeIcon,
  getResourceTypeName,
} from '../utils/resourceUtils';

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
