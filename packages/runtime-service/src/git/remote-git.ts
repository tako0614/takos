#!/usr/bin/env node
import readline from 'node:readline';

type GitRef = { name: string; target: string; type: 'branch' | 'tag' };

interface TreeEntry {
  name: string;
  type: 'file' | 'directory';
}

const remoteName = process.argv[2] || 'takos';
const remoteUrl = process.argv[3];

if (!remoteUrl) {
  console.error('git-remote-git: missing URL');
  process.exit(1);
}

function encodePath(rawPath: string): string {
  return rawPath.split('/').map(encodeURIComponent).join('/');
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function parseGitApiUrl(rawUrl: string): { apiBase: string; repoId: string; token: string } {
  const url = /^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const reposIndex = parts.indexOf('repos');
  const repoId = reposIndex >= 0 ? parts[reposIndex + 1] : parts[parts.length - 1];

  let basePath: string;
  if (parsed.pathname.includes('/api/git')) {
    basePath = parsed.pathname.split('/api/git')[0] + '/api/git';
  } else if (parsed.pathname.includes('/api')) {
    throw new Error('Unsupported remote API prefix. Use /api/git.');
  } else {
    basePath = parsed.pathname.replace(/\/[^/]*$/, '') + '/api/git';
  }

  return {
    apiBase: `${parsed.origin}${basePath.replace(/\/+$/, '')}`,
    repoId,
    // Prefer env var over URL param to avoid token leakage in shell history/logs
    token: process.env.TAKOS_TOKEN || parsed.searchParams.get('token') || '',
  };
}

const { apiBase, repoId, token } = parseGitApiUrl(remoteUrl);

async function apiFetch<T = unknown>(apiPath: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${apiPath}`, { headers });
  if (!res.ok) {
    throw new Error(`Git API error ${res.status} for ${apiPath}`);
  }
  return res.json() as Promise<T>;
}

async function listRefs(): Promise<GitRef[]> {
  const data = await apiFetch<{ refs?: GitRef[] }>(`/repos/${repoId}/refs`);
  return data.refs || [];
}

async function listFiles(ref: string, dir: string = ''): Promise<string[]> {
  const treePath = dir ? `/${encodePath(dir)}` : '';
  const data = await apiFetch<{ entries?: TreeEntry[] }>(`/repos/${repoId}/tree/${encodeURIComponent(ref)}${treePath}`);
  const files: string[] = [];
  for (const entry of data.entries || []) {
    const fullPath = joinPath(dir, entry.name);
    if (entry.type === 'directory') {
      files.push(...await listFiles(ref, fullPath));
    } else if (entry.type === 'file') {
      files.push(fullPath);
    }
  }
  return files;
}

async function fetchFile(ref: string, filePath: string): Promise<Buffer> {
  const data = await apiFetch<{ content_base64?: string }>(
    `/repos/${repoId}/blob/${encodeURIComponent(ref)}/${encodePath(filePath)}?base64=1`
  );
  return data.content_base64 ? Buffer.from(data.content_base64, 'base64') : Buffer.from('');
}

function writeLine(line: string = ''): void {
  process.stdout.write(line + '\n');
}

function writeData(content: Buffer | string): void {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  process.stdout.write(`data ${buffer.length}\n`);
  process.stdout.write(buffer);
  process.stdout.write('\n');
}

async function exportFastImport(refs: string[]): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000);
  for (const ref of refs) {
    const files = await listFiles(ref);
    writeLine(`commit ${ref}`);
    writeLine(`committer Takos Git <git@takos.local> ${timestamp} +0000`);
    writeData(`Import from git ${ref}`);
    writeLine('deleteall');
    for (const filePath of files) {
      const content = await fetchFile(ref, filePath);
      writeLine(`M 100644 inline ${filePath}`);
      writeData(content);
    }
  }
  writeLine('done');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pendingFetchRefs = new Set<string>();

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed === 'capabilities') {
    writeLine('import');
    writeLine(`refspec refs/heads/*:refs/remotes/${remoteName}/*`);
    writeLine();
    return;
  }

  if (trimmed === 'list') {
    const branches = (await listRefs()).filter(r => r.type === 'branch');
    for (const ref of branches) {
      writeLine(`${ref.target} ${ref.name}`);
    }
    writeLine();
    return;
  }

  if (trimmed.startsWith('option ')) {
    writeLine('unsupported');
    return;
  }

  if (trimmed.startsWith('fetch ')) {
    const ref = trimmed.split(/\s+/)[2];
    if (ref) pendingFetchRefs.add(ref);
    return;
  }

  if (trimmed === 'import') {
    const refs = pendingFetchRefs.size > 0
      ? Array.from(pendingFetchRefs)
      : (await listRefs()).filter(r => r.type === 'branch').map(r => r.name);
    pendingFetchRefs.clear();
    await exportFastImport(refs);
    return;
  }

  if (trimmed === 'quit') {
    rl.close();
    return;
  }
});
