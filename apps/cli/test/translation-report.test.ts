import { afterEach, describe, expect, it, vi } from 'vitest';
import { printTranslationReport, type TranslationReport } from '../src/lib/translation-report.js';

function captureOutput(logSpy: ReturnType<typeof vi.spyOn>) {
  return logSpy.mock.calls.map((args) => args.map((entry) => String(entry)).join(' ')).join('\n');
}

describe('printTranslationReport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints spec, runtime, backend, and realization summaries for Cloudflare', () => {
    const report: TranslationReport = {
      provider: 'cloudflare',
      supported: true,
      requirements: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'],
      resources: [{ resolutionMode: 'cloudflare-native' }],
      workloads: [{ status: 'native' }, { status: 'portable' }],
      routes: [{ status: 'native' }],
      unsupported: [],
    };

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTranslationReport(report);
    const output = captureOutput(logSpy);

    expect(output).toContain('Spec:     Cloudflare-native');
    expect(output).toContain('Runtime:  Takos runtime');
    expect(output).toContain('Backend:  Cloudflare backend');
    expect(output).toContain('supported');
    expect(output).toContain('Needs:    CF_ACCOUNT_ID, CF_API_TOKEN');
    expect(output).toContain('Resources: cloudflare-native=1');
    expect(output).toContain('Workloads: native=1, portable=1');
    expect(output).toContain('Routes:   native=1');
  });

  it('prints blocked status and unsupported details for compatibility backends', () => {
    const report: TranslationReport = {
      provider: 'aws',
      supported: false,
      requirements: ['OCI_ORCHESTRATOR_URL'],
      resources: [{ resolutionMode: 'provider-backed' }, { resolutionMode: 'takos-runtime' }],
      workloads: [{ status: 'portable' }],
      routes: [{ status: 'portable' }],
      unsupported: [
        {
          category: 'resource',
          name: 'db',
          message: 'd1 resolves to unknown (unsupported) on provider aws',
        },
      ],
    };

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTranslationReport(report);
    const output = captureOutput(logSpy);

    expect(output).toContain('Backend:  AWS compatibility backend');
    expect(output).toContain('blocked');
    expect(output).toContain('Needs:    OCI_ORCHESTRATOR_URL');
    expect(output).toContain('Resources: provider-backed=1, takos-runtime=1');
    expect(output).toContain('Workloads: portable=1');
    expect(output).toContain('Routes:   portable=1');
    expect(output).toContain('Blocked:');
    expect(output).toContain('resource.db d1 resolves to unknown (unsupported) on provider aws');
  });
});
