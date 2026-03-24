import { useState, useEffect } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { rpc, rpcJson } from '../../lib/rpc';
import { Icons } from '../../lib/Icons';
import { TIER_CONFIG, getTierFromModel, type AgentTier } from '../../lib/modelCatalog';

export function ModelTab({ spaceId }: { spaceId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTier, setSelectedTier] = useState<AgentTier>('takos-lite');

  useEffect(() => {
    fetchModelSettings();
  }, [spaceId]);

  const fetchModelSettings = async () => {
    setLoading(true);
    try {
      const res = await rpc.spaces[':spaceId'].model.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{
        ai_model?: string;
        model?: string;
        tier?: AgentTier;
      }>(res);
      if (data.tier) {
        setSelectedTier(data.tier);
      } else {
        const model = data.ai_model || data.model || '';
        setSelectedTier(getTierFromModel(model));
      }
    } catch (err) {
      console.error('Failed to fetch model settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await rpc.spaces[':spaceId'].model.$patch({
        param: { spaceId },
        json: { tier: selectedTier } as Record<string, string>,
      });
      await rpcJson(res);
      showToast('success', t('modelSettingsSaved'));
    } catch (err) {
      console.error('Failed to save model settings:', err);
      showToast('error', t('modelSettingsFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-3">
        <Icons.Loader className="w-5 h-5 animate-spin" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  const tiers = Object.entries(TIER_CONFIG) as [AgentTier, typeof TIER_CONFIG[AgentTier]][];

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">{t('modelProvider')}</h4>
        <div className="grid grid-cols-2 gap-3">
          {tiers.map(([tier, cfg]) => (
            <button
              key={tier}
              className={`flex flex-col items-start gap-1 p-4 rounded-lg border transition-colors text-left ${
                selectedTier === tier
                  ? 'border-zinc-900 dark:border-zinc-100 bg-white/10 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-900/50 dark:hover:border-zinc-400 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
              onClick={() => setSelectedTier(tier)}
              disabled={saving}
            >
              <span className="text-base font-semibold">{cfg.label}</span>
              <span className="text-xs opacity-70">{cfg.description}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        className="w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? (
          <>
            <Icons.Loader className="w-5 h-5 animate-spin" />
            <span>{t('saving')}</span>
          </>
        ) : (
          <span>{t('saveModelSettings')}</span>
        )}
      </button>
    </div>
  );
}
