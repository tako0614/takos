import { MODEL_OPTIONS, getModelLabel } from '../../lib/modelCatalog';
import { Icons } from '../../lib/Icons';

interface ModelSwitcherProps {
  selectedModel: string;
  isLoading?: boolean;
  onModelChange?: (model: string) => void;
}

export function ModelSwitcher({ selectedModel, isLoading = false, onModelChange }: ModelSwitcherProps) {
  if (!onModelChange) {
    return (
      <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {getModelLabel(selectedModel)}
      </span>
    );
  }

  return (
    <div className="relative">
      <select
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={isLoading}
        className="appearance-none bg-transparent text-base font-semibold text-zinc-900 dark:text-zinc-100 pr-6 cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {MODEL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id} className="bg-white dark:bg-zinc-900 text-base font-normal">
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 dark:text-zinc-400">
        <Icons.ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
}
