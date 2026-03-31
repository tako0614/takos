import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { type ActionContext } from '../executor.ts';
import { pushLog } from '../../logging.ts';
import { resolvePathWithin, isPathWithinBase } from '../../paths.ts';
import { s3Client, isR2Configured } from '../../../storage/r2.ts';
import { R2_BUCKET } from '../../../shared/config.ts';
import { getErrorMessage } from 'takos-common/errors';
import { LINE_UNSAFE_CHARS_PATTERN } from './cache-operations.ts';

function toStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function requireR2(operation: string): void {
  if (!isR2Configured()) {
    throw new Error(`R2 storage not configured, cannot ${operation}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function logTransferSummary(
  context: ActionContext,
  verb: string,
  count: number,
  totalBytes: number
): void {
  pushLog(context.logs, `${verb} ${count} file(s), ${formatBytes(totalBytes)} total`);
}

function validateArtifactName(rawName: string): string {
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new Error('Artifact name is required');
  }

  const artifactName = rawName.trim();
  if (artifactName.includes('..') || artifactName.includes('/') || artifactName.includes('\\')) {
    throw new Error('Artifact name contains invalid path characters');
  }
  if (LINE_UNSAFE_CHARS_PATTERN.test(artifactName)) {
    throw new Error('Artifact name contains control characters');
  }

  return artifactName;
}

/**
 * Checks the ifNoFiles policy. Throws on 'error', logs a warning on 'warn',
 * and silently does nothing on 'ignore'.
 */
function handleNoFilesFound(
  context: ActionContext,
  policy: 'warn' | 'error' | 'ignore',
  message: string
): void {
  if (policy === 'error') {
    throw new Error(message);
  }
  if (policy === 'warn') {
    pushLog(context.logs, `Warning: ${message}`);
  }
}

function buildArtifactR2Prefix(runId: string, artifactName: string): string {
  return `actions/artifacts/${runId}/${artifactName}/`;
}

async function collectFiles(
  dirPath: string,
  basePath: string
): Promise<Array<{ localPath: string; relativePath: string }>> {
  const files: Array<{ localPath: string; relativePath: string }> = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, fullPath);

    if (entry.isFile()) {
      files.push({ localPath: fullPath, relativePath });
    } else if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, basePath);
      files.push(...subFiles);
    }
  }

  return files;
}

export async function uploadArtifact(
  inputs: {
    name: string;
    path: string | string[];
    'retention-days'?: number;
    'if-no-files-found'?: 'warn' | 'error' | 'ignore';
    'compression-level'?: number;
  },
  context: ActionContext
): Promise<void> {
  pushLog(context.logs, 'Running actions/upload-artifact');
  requireR2('upload artifacts');

  const artifactName = validateArtifactName(inputs.name);
  const artifactPaths = toStringArray(inputs.path);
  const retentionDays = inputs['retention-days'] || 90;
  const ifNoFiles = inputs['if-no-files-found'] || 'warn';

  pushLog(context.logs, `Artifact name: ${artifactName}`);
  pushLog(context.logs, `Artifact paths: ${artifactPaths.join(', ')}`);

  const runId = context.env.GITHUB_RUN_ID || 'unknown';
  const r2ArtifactPrefix = buildArtifactR2Prefix(runId, artifactName);

  const filesToUpload: Array<{ localPath: string; relativePath: string }> = [];

  for (const artifactPath of artifactPaths) {
    try {
      const fullPath = resolvePathWithin(
        context.workspacePath,
        artifactPath,
        'artifact upload'
      );
      const lstat = await fs.lstat(fullPath);
      if (lstat.isSymbolicLink()) {
        throw new Error('Symbolic links are not allowed for artifact upload');
      }

      const stat = await fs.stat(fullPath);

      if (stat.isFile()) {
        filesToUpload.push({
          localPath: fullPath,
          relativePath: path.basename(fullPath),
        });
      } else if (stat.isDirectory()) {
        const files = await collectFiles(fullPath, fullPath);
        filesToUpload.push(...files);
      }
    } catch (err) {
      if (ifNoFiles === 'error') {
        throw new Error(`Artifact path is invalid or not found: ${artifactPath} (${getErrorMessage(err)})`);
      }
      if (ifNoFiles === 'warn') {
        pushLog(context.logs, `Warning: Artifact path is invalid or not found: ${artifactPath}`);
      }
    }
  }

  if (filesToUpload.length === 0) {
    handleNoFilesFound(context, ifNoFiles, 'No files found to upload');
    return;
  }

  pushLog(context.logs, `Uploading ${filesToUpload.length} file(s)...`);

  let uploadedCount = 0;
  let totalBytes = 0;

  for (const file of filesToUpload) {
    try {
      const content = await fs.readFile(file.localPath);
      const r2Key = `${r2ArtifactPrefix}${file.relativePath}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: content,
          Metadata: {
            'artifact-name': artifactName,
            'file-path': file.relativePath,
            'uploaded-at': new Date().toISOString(),
            'retention-days': String(retentionDays),
          },
        })
      );

      uploadedCount++;
      totalBytes += content.length;
    } catch (err) {
      pushLog(context.logs, `Warning: Failed to upload ${file.relativePath}: ${err}`);
    }
  }

  logTransferSummary(context, 'Uploaded', uploadedCount, totalBytes);
  context.setOutput('artifact-url', `r2://${R2_BUCKET}/${r2ArtifactPrefix}`);
}

export async function downloadArtifact(
  inputs: {
    name: string;
    path?: string;
    'run-id'?: string;
  },
  context: ActionContext
): Promise<void> {
  pushLog(context.logs, 'Running actions/download-artifact');
  requireR2('download artifacts');

  const artifactName = validateArtifactName(inputs.name);
  const downloadPath = inputs.path
    ? resolvePathWithin(context.workspacePath, inputs.path, 'artifact download')
    : path.join(context.workspacePath, artifactName);
  const runId = inputs['run-id'] || context.env.GITHUB_RUN_ID || 'unknown';

  pushLog(context.logs, `Downloading artifact: ${artifactName}`);
  pushLog(context.logs, `Download path: ${downloadPath}`);

  await fs.mkdir(downloadPath, { recursive: true });

  const r2ArtifactPrefix = buildArtifactR2Prefix(runId, artifactName);

  let continuationToken: string | undefined;
  let downloadedCount = 0;
  let totalBytes = 0;

  do {
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: r2ArtifactPrefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of listResult.Contents || []) {
      if (!obj.Key) continue;

      const relativePath = obj.Key.slice(r2ArtifactPrefix.length);
      if (!relativePath) continue;

      // Security: reject relative paths containing ".." segments or absolute
      // paths to prevent path traversal when writing downloaded artifacts.
      if (relativePath.includes('..') || path.isAbsolute(relativePath)) {
        pushLog(context.logs, `Warning: Skipping unsafe artifact path: ${relativePath}`);
        continue;
      }

      try {
        const getResult = await s3Client.send(
          new GetObjectCommand({
            Bucket: R2_BUCKET,
            Key: obj.Key,
          })
        );

        if (getResult.Body) {
          const content = await getResult.Body.transformToByteArray();
          const localPath = path.join(downloadPath, relativePath);

          // Security: verify the resolved path is still within downloadPath
          // after path.join() normalisation (defense-in-depth).
          const resolvedDownload = path.resolve(downloadPath);
          const resolvedLocal = path.resolve(localPath);
          if (!isPathWithinBase(resolvedDownload, resolvedLocal, { allowBase: false })) {
            pushLog(context.logs, `Warning: Skipping artifact that escapes download directory: ${relativePath}`);
            continue;
          }

          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await fs.writeFile(localPath, content);

          downloadedCount++;
          totalBytes += content.length;
        }
      } catch (err) {
        pushLog(context.logs, `Warning: Failed to download ${relativePath}: ${err}`);
      }
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  if (downloadedCount === 0) {
    throw new Error(`Artifact not found: ${artifactName}`);
  }

  logTransferSummary(context, 'Downloaded', downloadedCount, totalBytes);
  context.setOutput('download-path', downloadPath);
}
