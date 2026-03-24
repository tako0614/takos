import { getTierFromModel, TIER_CONFIG, type AgentTier } from '../../lib/modelCatalog';
import { Icons } from '../../lib/Icons';

interface ModelSwitcherProps {
  selectedModel: string;
  isLoading?: boolean;
  onTierChange?: (model: string) => void;
}

export function ModelSwitcher({ selectedModel, isLoading = false, onTierChange }: ModelSwitcherProps) {
  const tier = getTierFromModel(selectedModel);

  if (!onTierChange) {
    return (
      <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {TIER_CONFIG[tier].label}
      </span>
    );
  }

  return (
    <div className="relative">
      <select
        value={tier}
        onChange={(e) => {
          const t = e.target.value as AgentTier;
          onTierChange(TIER_CONFIG[t].model);
        }}
        disabled={isLoading}
        className="appearance-none bg-transparent text-base font-semibold text-zinc-900 dark:text-zinc-100 pr-6 cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {(Object.entries(TIER_CONFIG) as [AgentTier, typeof TIER_CONFIG[AgentTier]][]).map(([t, cfg]) => (
          <option key={t} value={t} className="bg-white dark:bg-zinc-900 text-base font-normal">
            {cfg.label}
          </option>
        ))}
      </select>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 dark:text-zinc-400">
        <Icons.ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
}
