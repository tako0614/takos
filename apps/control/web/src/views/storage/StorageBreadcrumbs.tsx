import { Fragment } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';

interface StorageBreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function StorageBreadcrumbs({ currentPath, onNavigate }: StorageBreadcrumbsProps) {
  const { t } = useI18n();
  const breadcrumbParts = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  return (
    <div className="flex-shrink-0 flex items-center gap-1 px-5 pb-2 overflow-x-auto">
      <button
        onClick={() => onNavigate('/')}
        className={
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors '
          + (breadcrumbParts.length === 0
            ? 'font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-200/60 dark:bg-zinc-800'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800')
        }
      >
        <Icons.HardDrive className="w-4 h-4" />
        {t('storageTitle')}
      </button>
      {breadcrumbParts.map((part, index) => {
        const isLast = index === breadcrumbParts.length - 1;
        return (
          <Fragment key={index}>
            <Icons.ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            <button
              onClick={() => onNavigate('/' + breadcrumbParts.slice(0, index + 1).join('/'))}
              className={
                'px-3 py-1.5 rounded-lg text-sm truncate max-w-[200px] transition-colors '
                + (isLast
                  ? 'font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-200/60 dark:bg-zinc-800'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800')
              }
            >
              {part}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
