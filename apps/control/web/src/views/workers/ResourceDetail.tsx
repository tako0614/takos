import type { ReactNode } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import type { Resource } from '../../types';
import type { ResourceDetailTab } from './types';
import { Breadcrumb } from '../../components/ui/Breadcrumb';
import { ResourceOverviewTab } from './tabs/ResourceOverviewTab';
import { D1ExplorerTab } from './tabs/D1ExplorerTab';
import { R2BrowserTab } from './tabs/R2BrowserTab';
import { ResourceBindingsTab } from './tabs/ResourceBindingsTab';
import { ResourceSettingsTab } from './tabs/ResourceSettingsTab';

export interface ResourceDetailProps {
  resource: Resource;
  tab: ResourceDetailTab;
  onBack: () => void;
  onTabChange: (tab: ResourceDetailTab) => void;
  getResourceTypeIcon: (type: Resource['type']) => ReactNode;
  getResourceTypeName: (type: Resource['type']) => string;
  getResourceStatusBgClass: (status: Resource['status']) => string;
  onDeleteResource: () => void;
}

export function ResourceDetail({
  resource,
  tab,
  onBack,
  onTabChange,
  getResourceTypeIcon,
  getResourceTypeName,
  getResourceStatusBgClass,
  onDeleteResource,
}: ResourceDetailProps) {
  const { t } = useI18n();

  const tabClass = (tabId: ResourceDetailTab): string =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      tab === tabId
        ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700'
    }`;

  const breadcrumbItems = [
    { label: t('resources'), onClick: onBack },
    { label: resource.name },
  ];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      <header className="flex flex-col gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
        <Breadcrumb items={breadcrumbItems} />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <span className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-xl text-zinc-900 dark:text-zinc-100" aria-hidden="true">
              {getResourceTypeIcon(resource.type)}
            </span>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{resource.name}</h1>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{getResourceTypeName(resource.type)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2" aria-label={`Status: ${resource.status}`}>
            <span className={`w-2 h-2 rounded-full ${getResourceStatusBgClass(resource.status)}`} aria-hidden="true" />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{resource.status}</span>
          </div>
        </div>
      </header>

      <nav className="flex gap-1 px-6 pt-4 border-b border-zinc-200 dark:border-zinc-700" role="tablist" aria-label="Resource sections">
        <button
          role="tab"
          aria-selected={tab === 'overview'}
          aria-controls="tabpanel-overview"
          className={tabClass('overview')}
          onClick={() => onTabChange('overview')}
        >
          {t('overview')}
        </button>
        {resource.type === 'd1' && (
          <button
            role="tab"
            aria-selected={tab === 'explorer'}
            aria-controls="tabpanel-explorer"
            className={tabClass('explorer')}
            onClick={() => onTabChange('explorer')}
          >
            {t('explorer')}
          </button>
        )}
        {resource.type === 'r2' && (
          <button
            role="tab"
            aria-selected={tab === 'browser'}
            aria-controls="tabpanel-browser"
            className={tabClass('browser')}
            onClick={() => onTabChange('browser')}
          >
            {t('browser')}
          </button>
        )}
        <button
          role="tab"
          aria-selected={tab === 'bindings'}
          aria-controls="tabpanel-bindings"
          className={tabClass('bindings')}
          onClick={() => onTabChange('bindings')}
        >
          {t('bindings')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'settings'}
          aria-controls="tabpanel-settings"
          className={tabClass('settings')}
          onClick={() => onTabChange('settings')}
        >
          {t('settings')}
        </button>
      </nav>

      <div className="flex-1 overflow-auto p-6" role="tabpanel" id={`tabpanel-${tab}`} aria-label={tab}>
        {tab === 'overview' && <ResourceOverviewTab resource={resource} />}
        {tab === 'explorer' && resource.type === 'd1' && <D1ExplorerTab resource={resource} />}
        {tab === 'browser' && resource.type === 'r2' && <R2BrowserTab resource={resource} />}
        {tab === 'bindings' && <ResourceBindingsTab resource={resource} />}
        {tab === 'settings' && <ResourceSettingsTab onDeleteResource={onDeleteResource} />}
      </div>
    </div>
  );
}
