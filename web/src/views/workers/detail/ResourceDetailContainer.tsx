import type { Resource } from "../../../types/index.ts";
import { useI18n } from "../../../store/i18n.ts";
import { ResourceDetail } from "../ResourceDetail.tsx";
import type { ResourceDetailTab } from "../worker-models.ts";
import {
  getResourceStatusBgClass,
  getResourceTypeIcon,
  getResourceTypeName,
} from "../utils/resourceUtils.tsx";

export interface ResourceDetailContainerProps {
  resource: Resource;
  tab: ResourceDetailTab;
  onBack: () => void;
  onTabChange: (tab: ResourceDetailTab) => void;
  onDeleteResource: (resource: Resource) => void;
}

export function ResourceDetailContainer(props: ResourceDetailContainerProps) {
  const { t } = useI18n();

  return (
    <ResourceDetail
      resource={props.resource}
      tab={props.tab}
      onBack={props.onBack}
      onTabChange={props.onTabChange}
      getResourceTypeIcon={getResourceTypeIcon}
      getResourceTypeName={(type) => getResourceTypeName(type, t)}
      getResourceStatusBgClass={getResourceStatusBgClass}
      onDeleteResource={() => props.onDeleteResource(props.resource)}
    />
  );
}
