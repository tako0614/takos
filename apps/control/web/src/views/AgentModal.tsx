import { createEffect, onMount, onCleanup, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { useI18n, type TranslationKey } from '../store/i18n';
import { Icons } from '../lib/Icons';
import type { Space } from '../types';
import { SkillsTab } from './agent/SkillsTab';
import { MemoryTab } from './agent/MemoryTab';
import { ModelTab } from './agent/ModelTab';
import { WorkTab } from './agent/WorkTab';
import { McpServersSection } from './hub/McpServersSection';

type AgentTab = 'skills' | 'memory' | 'model' | 'work' | 'tools';

export interface AgentModalProps {
  spaceId: string;
  spaces: Space[];
  onClose: () => void;
}

const TAB_CONFIG: { id: AgentTab; icon: JSX.Element; labelKey: TranslationKey; descriptionKey: TranslationKey }[] = [
  { id: 'work', icon: <Icons.Check />, labelKey: 'tabWork', descriptionKey: 'tabWorkDescription' },
  { id: 'model', icon: <Icons.Sparkles />, labelKey: 'tabModel', descriptionKey: 'tabModelDescription' },
  { id: 'tools', icon: <Icons.Wrench />, labelKey: 'tabTools', descriptionKey: 'tabToolsDescription' },
  { id: 'skills', icon: <Icons.Code />, labelKey: 'tabSkills', descriptionKey: 'tabSkillsDescription' },
  { id: 'memory', icon: <Icons.HardDrive />, labelKey: 'tabMemory', descriptionKey: 'tabMemoryDescription' },
];

export function AgentModal({
  spaceId,
  spaces,
  onClose,
}: AgentModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = createSignal<AgentTab>('work');
  const [selectedToolsWsId, setSelectedToolsWsId] = createSignal<string>(spaceId);
  const activeTabMeta = () => TAB_CONFIG.find((tab) => tab.id === activeTab()) ?? TAB_CONFIG[0];

  createEffect(() => {
    setSelectedToolsWsId(spaceId);
  });

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-modal-title"
    >
      <div
        class="bg-zinc-50 dark:bg-zinc-900 rounded-t-xl md:rounded-xl w-full md:max-w-4xl lg:max-w-5xl h-[90vh] md:max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ "padding-bottom": 'var(--spacing-safe-bottom)' }}
      >
        <div class="flex items-start justify-between gap-4 px-4 md:px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <div class="space-y-1">
            <p class="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              {t('agentSettings')}
            </p>
            <h3 id="agent-modal-title" class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t(activeTabMeta().labelKey)}
            </h3>
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {t(activeTabMeta().descriptionKey)}
            </p>
          </div>
          <button
            type="button"
            class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white/10 transition-colors"
            onClick={onClose}
            aria-label={t('close')}
          >
            <Icons.X />
          </button>
        </div>
        <div class="flex overflow-x-auto border-b border-zinc-200 dark:border-zinc-700 shrink-0" role="tablist" aria-label="Agent settings">
          {TAB_CONFIG.map(({ id, icon, labelKey }) => (
            <button
              id={`agent-tab-${id}`}
              type="button"
              class={`flex items-center gap-2 px-4 min-h-[44px] min-w-max text-sm font-medium transition-colors whitespace-nowrap ${activeTab() === id ? 'text-zinc-900 dark:text-zinc-100 border-b-2 border-zinc-900 dark:border-zinc-100' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
              onClick={() => setActiveTab(id)}
              role="tab"
              aria-selected={activeTab() === id}
              aria-controls={`agent-tabpanel-${id}`}
            >
              {icon}
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
        <div
          class="flex-1 overflow-y-auto p-4 md:p-6"
          role="tabpanel"
          id={`agent-tabpanel-${activeTab()}`}
          aria-labelledby={`agent-tab-${activeTab()}`}
        >
          {activeTab() === 'skills' && <SkillsTab spaceId={spaceId} />}
          {activeTab() === 'memory' && <MemoryTab spaceId={spaceId} />}
          {activeTab() === 'model' && <ModelTab spaceId={spaceId} />}
          {activeTab() === 'work' && <WorkTab spaceId={spaceId} />}
          {activeTab() === 'tools' && (
            <McpServersSection
              spaces={spaces}
              selectedSpaceId={selectedToolsWsId()}
              setSelectedSpaceId={setSelectedToolsWsId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
