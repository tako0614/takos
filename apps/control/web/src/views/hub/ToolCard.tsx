import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { Button } from '../../components/ui/Button';
import type { CustomTool } from '../../types';

export interface ToolCardProps {
  tool: CustomTool;
  onToggle: () => void;
  onEdit: () => void;
  onExecute: () => void;
  onDelete: () => void;
}

export function ToolCard({ tool, onToggle, onEdit, onExecute, onDelete }: ToolCardProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-500">
        <Icons.Server className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {tool.name}
          </h4>
          {tool.takopackId && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
              {t('takopack')}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
          {tool.description}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title={tool.enabled ? t('disable') : t('enable')}
        >
          {tool.enabled ? (
            <Icons.ToggleOnFilled className="w-6 h-6 text-blue-500" />
          ) : (
            <Icons.ToggleOffFilled className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
          )}
        </button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onExecute}
          leftIcon={<Icons.Play className="w-4 h-4" />}
        >
          {t('test')}
        </Button>

        {!tool.takopackId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
          >
            <Icons.Edit className="w-4 h-4 text-zinc-400 hover:text-blue-500" />
          </Button>
        )}

        {!tool.takopackId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
          >
            <Icons.Trash className="w-4 h-4 text-zinc-400 hover:text-red-500" />
          </Button>
        )}
      </div>
    </div>
  );
}
