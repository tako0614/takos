import { describe, expect, it } from 'vitest';
import {
  appManifestToBundleDocs,
  buildBundlePackageData,
  extractBuildSourcesFromManifestJson,
  parseAppManifestYaml,
} from '@/services/source/app-manifest';
import { parsePackage } from '@/services/takopack/manifest';

describe('app manifest service', () => {
  it('rejects legacy local build fields', () => {
    expect(() => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-app
spec:
  version: 1.0.0
  services:
    api:
      type: worker
      build:
        command: pnpm build
        output: dist/api.mjs
`)).toThrow(/local build fields are not supported/);
  });

  it('rejects non-worker services in current contract', () => {
    expect(() => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-app
spec:
  version: 1.0.0
  services:
    api:
      type: http
      baseUrl: https://example.internal
`)).toThrow(/type must be worker/);
  });

  it('round-trips build source labels through bundle manifest json', async () => {
    const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: sample-app
spec:
  version: 1.0.0
  services:
    api:
      type: worker
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
  routes:
    - service: api
      path: /
`);

    const docs = appManifestToBundleDocs(manifest, new Map([
      ['api', {
        service_name: 'api',
        workflow_path: '.takos/workflows/build.yml',
        workflow_job: 'build-api',
        workflow_artifact: 'api-dist',
        artifact_path: 'dist/api.mjs',
        workflow_run_id: 'run-1',
        workflow_job_id: 'job-1',
        source_sha: 'sha-1',
      }],
    ]));

    const bundleData = await buildBundlePackageData(docs, new Map([
      ['dist/api.mjs', new TextEncoder().encode('export default {};').buffer],
    ]));
    const parsed = await parsePackage(bundleData);
    const buildSources = extractBuildSourcesFromManifestJson(JSON.stringify(parsed.manifest));

    expect(buildSources).toEqual([{
      service_name: 'api',
      workflow_path: '.takos/workflows/build.yml',
      workflow_job: 'build-api',
      workflow_artifact: 'api-dist',
      artifact_path: 'dist/api.mjs',
      workflow_run_id: 'run-1',
      workflow_job_id: 'job-1',
      source_sha: 'sha-1',
    }]);
  });
});
