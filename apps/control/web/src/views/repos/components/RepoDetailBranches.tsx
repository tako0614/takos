import { useState, useEffect, useRef } from 'react';
import type { Branch } from '../../../types';
import { Icons } from '../../../lib/Icons';
import { useI18n } from '../../../providers/I18nProvider';

interface RepoDetailBranchesProps {
  branches: Branch[];
  currentBranch: string;
  onBranchChange: (branch: string) => void;
}

export function RepoDetailBranches({
  branches,
  currentBranch,
  onBranchChange,
}: RepoDetailBranchesProps) {
  const { t } = useI18n();
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!branchDropdownOpen) return;

    function handleClickOutside(event: MouseEvent): void {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
        setBranchDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [branchDropdownOpen]);

  return (
    <div className="flex items-center gap-3">
      <div className="relative" ref={branchDropdownRef}>
        <button
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={() => setBranchDropdownOpen(!branchDropdownOpen)}
        >
          <Icons.GitMerge className="w-4 h-4" />
          <span className="font-medium">{currentBranch}</span>
          <Icons.ChevronDown className="w-4 h-4" />
        </button>
        {branchDropdownOpen && (
          <div className="absolute left-0 top-full mt-1 w-72 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg z-20">
            <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('switchBranches')}</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {branches.map(branch => (
                <button
                  key={branch.name}
                  className={`flex items-center justify-between w-full px-3 py-2 text-sm text-left transition-colors ${
                    branch.name === currentBranch
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                  onClick={() => {
                    onBranchChange(branch.name);
                    setBranchDropdownOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    {branch.name === currentBranch && <Icons.Check className="w-4 h-4" />}
                    <span>{branch.name}</span>
                  </div>
                  {branch.is_default && (
                    <span className="px-1.5 py-0.5 text-xs rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400">{t('default')}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="text-sm text-zinc-500 dark:text-zinc-400">
        {t('branchCount', { count: branches.length })}
      </span>
    </div>
  );
}
