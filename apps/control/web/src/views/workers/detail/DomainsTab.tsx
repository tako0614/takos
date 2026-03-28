import { useI18n } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';
import type { Worker } from '../../../types';
import type { WorkerDomain, VerificationInfo } from '../worker-models';
import {
  getWorkerDisplayHostname,
  getWorkerUrl,
} from '../utils/workerUtils';

interface DomainsTabProps {
  worker: Worker;
  workerDomains: WorkerDomain[];
  loadingWorkerDomains: boolean;
  verificationInfo: VerificationInfo | null;
  onCloseVerificationInfo: () => void;
  newWorkerDomain: string;
  onNewWorkerDomainChange: (value: string) => void;
  onAddWorkerDomain: () => void;
  addingWorkerDomain: boolean;
  onVerifyWorkerDomain: (domainId: string) => void;
  onDeleteWorkerDomain: (domainId: string) => void;
}

export function DomainsTab({
  worker,
  workerDomains,
  loadingWorkerDomains,
  verificationInfo,
  onCloseVerificationInfo,
  newWorkerDomain,
  onNewWorkerDomainChange,
  onAddWorkerDomain,
  addingWorkerDomain,
  onVerifyWorkerDomain,
  onDeleteWorkerDomain,
}: DomainsTabProps) {
  const { t } = useI18n();
  const workerHostname = getWorkerDisplayHostname(worker);
  const workerUrl = getWorkerUrl(worker);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('platformDomain')}</h4>
        {workerUrl ? (
          <a
            href={workerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-900 dark:text-zinc-100 hover:underline flex items-center gap-1"
          >
            <Icons.Globe className="w-4 h-4" />
            <span>{workerHostname}</span>
            <Icons.ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
            <Icons.Globe className="w-4 h-4" />
            <span>{workerHostname}</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('customDomains')}</h4>

        {loadingWorkerDomains ? (
          <div className="flex items-center gap-2 text-zinc-500"><Icons.Loader className="w-4 h-4 animate-spin" /><span>{t('loading')}</span></div>
        ) : (
          <>
            {workerDomains.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noCustomDomains')}</p>
            ) : (
              <div className="space-y-2">
                {workerDomains.map(domain => (
                  <div key={domain.id} className="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Icons.Globe className="w-4 h-4 text-zinc-500" />
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{domain.domain}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${
                          domain.status === 'active' ? 'bg-zinc-900 text-white border-zinc-900' :
                          domain.status === 'pending' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-600' :
                          'bg-white text-zinc-500 border-zinc-400'
                        }`}>
                          {domain.status === 'active' ? t('domainActive') : domain.status === 'pending' ? t('domainPending') : domain.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {domain.status === 'pending' && (
                          <button
                            className="px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-xs font-medium transition-colors"
                            onClick={() => onVerifyWorkerDomain(domain.id)}
                          >
                            {t('verifyDomain')}
                          </button>
                        )}
                        <button
                          className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                          onClick={() => onDeleteWorkerDomain(domain.id)}
                        >
                          <Icons.Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {domain.status === 'pending' && (
                      <div className="mt-3 p-3 bg-white rounded-lg">
                        <p className="text-xs text-zinc-500">{t('cnameInstruction')}</p>
                        <code className="block mt-1 text-xs text-zinc-700 font-mono">
                          {domain.verification_method === 'cname'
                            ? `_acme-challenge.${domain.domain} CNAME`
                            : `_takos-verify.${domain.domain} TXT`}
                        </code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {verificationInfo && (
              <div className="p-4 bg-zinc-50 border border-zinc-300 rounded-xl">
                <h5 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('dnsSetup')}</h5>
                <p className="text-xs text-zinc-700 mb-2">{verificationInfo.instructions}</p>
                <div className="space-y-1">
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500">Record:</span>
                    <code className="text-zinc-700 font-mono">{verificationInfo.record}</code>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-zinc-500">Target:</span>
                    <code className="text-zinc-700 font-mono">{verificationInfo.target}</code>
                  </div>
                </div>
                <button
                  className="mt-2 text-xs text-zinc-500 hover:text-zinc-900"
                  onClick={onCloseVerificationInfo}
                >
                  {t('close')}
                </button>
              </div>
            )}

            <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <input
                type="text"
                className="flex-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                value={newWorkerDomain}
                onChange={(e) => onNewWorkerDomainChange(e.target.value.toLowerCase())}
                placeholder="example.com"
              />
              <button
                className="px-4 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                onClick={onAddWorkerDomain}
                disabled={addingWorkerDomain || !newWorkerDomain.trim()}
              >
                {addingWorkerDomain ? t('adding') : t('addDomain')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
