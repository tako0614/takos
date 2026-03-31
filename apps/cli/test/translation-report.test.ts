import { assertStringIncludes } from 'jsr:@std/assert';
import { stub } from 'jsr:@std/testing/mock';
import { printTranslationReport, type TranslationReport } from '../src/lib/translation-report.ts';

function captureOutput(logSpy: { calls: Array<{ args: unknown[] }> }): string {
  return logSpy.calls
    .map((call) => call.args.map((entry) => String(entry)).join(' '))
    .join('\n');
}

Deno.test('printTranslationReport - prints spec, runtime, backend, and realization summaries for Cloudflare', () => {
  const report: TranslationReport = {
    provider: 'cloudflare',
    supported: true,
    requirements: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'],
    resources: [{ resolutionMode: 'cloudflare-native' }],
    workloads: [{ status: 'native' }, { status: 'portable' }],
    routes: [{ status: 'native' }],
    unsupported: [],
  };

  const logSpy = stub(console, 'log', () => {});

  try {
    printTranslationReport(report);
    const output = captureOutput(logSpy);

    assertStringIncludes(output, 'Spec:     Cloudflare-native');
    assertStringIncludes(output, 'Runtime:  Takos runtime');
    assertStringIncludes(output, 'Backend:  Cloudflare backend');
    assertStringIncludes(output, 'supported');
    assertStringIncludes(output, 'Needs:    CF_ACCOUNT_ID, CF_API_TOKEN');
    assertStringIncludes(output, 'Resources: cloudflare-native=1');
    assertStringIncludes(output, 'Workloads: native=1, portable=1');
    assertStringIncludes(output, 'Routes:   native=1');
  } finally {
    logSpy.restore();
  }
});

Deno.test('printTranslationReport - prints blocked status and unsupported details for compatibility backends', () => {
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

  const logSpy = stub(console, 'log', () => {});

  try {
    printTranslationReport(report);
    const output = captureOutput(logSpy);

    assertStringIncludes(output, 'Backend:  AWS compatibility backend');
    assertStringIncludes(output, 'blocked');
    assertStringIncludes(output, 'Needs:    OCI_ORCHESTRATOR_URL');
    assertStringIncludes(output, 'Resources: provider-backed=1, takos-runtime=1');
    assertStringIncludes(output, 'Workloads: portable=1');
    assertStringIncludes(output, 'Routes:   portable=1');
    assertStringIncludes(output, 'Blocked:');
    assertStringIncludes(output, 'resource.db d1 resolves to unknown (unsupported) on provider aws');
  } finally {
    logSpy.restore();
  }
});
