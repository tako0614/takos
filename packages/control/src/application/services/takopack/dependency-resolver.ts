import { getDb, type Database } from '../../../infra/db';
import { repoReleases, repoReleaseAssets, repositories, accounts } from '../../../infra/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { safeJsonParseOrDefault } from '../../../shared/utils';
/** Safely retrieve a value from a Map, throwing a descriptive error if the key is missing. */
function getOrThrow<K, V>(map: Map<K, V>, key: K, msg: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(msg);
  return v;
}
import { checkRepoAccess } from '../source/repos';
import { toReleaseAssets } from '../source/repo-release-assets';
import type { TakopackManifest, ReleaseAsset } from './types';
import { compareSemver, parseSemver, parseSemverRange, satisfiesSemverRange, type SemverRange } from './semver';
import { parseRepoRef, normalizeDependencies } from './validator';

const ROOT_DEP_SOURCE_KEY = '__root__';

export type RepoLookup = {
  id: string;
  name: string;
  visibility: string;
  owner_username: string;
};

export type RangeSpec = { raw: string; parsed: SemverRange };

export type DependencyCandidate = {
  repoId: string;
  repoRef: string;
  name: string;
  appId: string;
  version: string;
  source: 'installed' | 'release';
  releaseTag?: string;
  assetId?: string;
  dependencies: NonNullable<TakopackManifest['dependencies']>[number][];
};

type DepEdge = { targetRepoId: string; range: RangeSpec; repoRef: string };

export type InstalledTakopack = {
  id: string;
  name: string;
  appId: string;
  installKey: string;
  version: string;
  isPinned: boolean;
  sourceType: string | null;
  sourceRepoId: string | null;
  manifestJson: string | null;
};

export function makeRangeSpec(raw: string): RangeSpec {
  return { raw, parsed: parseSemverRange(raw) };
}

function satisfiesAll(version: string, ranges: Iterable<RangeSpec>): boolean {
  for (const r of ranges) {
    if (!satisfiesSemverRange(version, r.parsed)) return false;
  }
  return true;
}

function topologicalSort(
  selected: Map<string, DependencyCandidate>,
  outgoingBySource: Map<string, DepEdge[]>,
): string[] {
  const depGraph = new Map<string, string[]>();
  for (const [repoId, edges] of outgoingBySource.entries()) {
    if (repoId === ROOT_DEP_SOURCE_KEY) continue;
    depGraph.set(repoId, edges.map((e) => e.targetRepoId));
  }
  for (const repoId of selected.keys()) {
    if (!depGraph.has(repoId)) depGraph.set(repoId, []);
  }

  const temp = new Set<string>();
  const perm = new Set<string>();
  const order: string[] = [];

  function visit(n: string): void {
    if (perm.has(n)) return;
    if (temp.has(n)) {
      throw new Error(`Dependency cycle detected at repo: ${n}`);
    }
    temp.add(n);
    for (const d of depGraph.get(n) || []) {
      if (selected.has(d)) visit(d);
    }
    temp.delete(n);
    perm.add(n);
    order.push(n);
  }

  for (const n of selected.keys()) visit(n);
  return order;
}

export class DependencyResolver {
  private constraintsByTarget = new Map<string, Map<string, RangeSpec>>();
  private outgoingBySource = new Map<string, DepEdge[]>();
  private selected = new Map<string, DependencyCandidate>();
  private pending = new Set<string>();
  private repoRefCache = new Map<string, RepoLookup>();
  private candidatesCache = new Map<string, DependencyCandidate[]>();

  constructor(
    private db: Database,
    private env: Env,
    private userId: string,
    private installedGitByRepoId: Map<string, InstalledTakopack>,
  ) {}

  async resolveRepoRef(repoRef: string): Promise<RepoLookup> {
    const parts = parseRepoRef(repoRef);
    if (!parts) {
      throw new Error(`Invalid dependency repo reference: ${repoRef}`);
    }

    const key = `${parts.username.toLowerCase()}/${parts.repoName.toLowerCase()}`;
    const cached = this.repoRefCache.get(key);
    if (cached) return cached;

    const rows = this.db.all<RepoLookup>(sql`
      SELECT
        r.id AS id,
        r.name AS name,
        r.visibility AS visibility,
        u.slug AS owner_username
      FROM repositories r
      JOIN accounts u ON u.id = r.account_id
      WHERE lower(r.name) = lower(${parts.repoName})
        AND lower(u.slug) = lower(${parts.username})
      LIMIT 1
    `);

    const resolvedRows = await rows;
    const row = resolvedRows[0];
    if (!row) {
      throw new Error(`Dependency repository not found: ${repoRef}`);
    }

    this.repoRefCache.set(key, row);
    return row;
  }

  async ensureRepoAccessible(repoId: string, visibility: string): Promise<void> {
    const access = await checkRepoAccess(this.env, repoId, this.userId);
    if (access) return;
    if (visibility !== 'public') {
      throw new Error('Repository not found');
    }
  }

  setConstraint(targetRepoId: string, sourceKey: string, r: RangeSpec, repoRef: string): void {
    let m = this.constraintsByTarget.get(targetRepoId);
    if (!m) {
      m = new Map();
      this.constraintsByTarget.set(targetRepoId, m);
    }

    if (m.has(sourceKey)) {
      throw new Error(`Duplicate dependency constraint from ${sourceKey} to ${repoRef}`);
    }

    m.set(sourceKey, r);
    this.pending.add(targetRepoId);
  }

  removeOutgoingConstraints(sourceKey: string): void {
    const edges = this.outgoingBySource.get(sourceKey) || [];
    this.outgoingBySource.delete(sourceKey);
    for (const edge of edges) {
      const m = this.constraintsByTarget.get(edge.targetRepoId);
      if (!m) continue;
      if (m.delete(sourceKey)) {
        if (m.size === 0) this.constraintsByTarget.delete(edge.targetRepoId);
        this.pending.add(edge.targetRepoId);
      }
    }
  }

  async getReleaseCandidates(repo: RepoLookup): Promise<DependencyCandidate[]> {
    const cached = this.candidatesCache.get(repo.id);
    if (cached) return cached;

    await this.ensureRepoAccessible(repo.id, repo.visibility);

    const releases = await this.db.select().from(repoReleases).where(
      and(
        eq(repoReleases.repoId, repo.id),
        eq(repoReleases.isDraft, false),
        eq(repoReleases.isPrerelease, false),
      )
    ).orderBy(desc(repoReleases.publishedAt)).limit(100).all();

    const out: DependencyCandidate[] = [];
    for (const release of releases) {
      const releaseAssetRows = await this.db.select().from(repoReleaseAssets).where(
        eq(repoReleaseAssets.releaseId, release.id)
      ).orderBy(repoReleaseAssets.createdAt).all();

      const assets = toReleaseAssets(releaseAssetRows);
      const bundleAssets = assets.filter((asset: ReleaseAsset) => asset.bundle_format === 'takopack');
      for (const asset of bundleAssets) {
        const v = asset.bundle_meta?.version || release.tag;
        if (!parseSemver(v)) continue;
        const deps = normalizeDependencies(asset.bundle_meta?.dependencies);
        out.push({
          repoId: repo.id,
          repoRef: `@${repo.owner_username}/${repo.name}`,
          name: asset.bundle_meta?.name || repo.name,
          appId: asset.bundle_meta?.app_id || asset.bundle_meta?.name || repo.name,
          version: v,
          source: 'release',
          releaseTag: release.tag,
          assetId: asset.id,
          dependencies: deps,
        });
      }
    }

    out.sort((a, b) => {
      const d = compareSemver(a.version, b.version);
      if (d !== 0) return -d;
      return (a.releaseTag || '').localeCompare(b.releaseTag || '');
    });

    this.candidatesCache.set(repo.id, out);
    return out;
  }

  async selectCandidate(repo: RepoLookup, ranges: RangeSpec[]): Promise<DependencyCandidate> {
    const installed = this.installedGitByRepoId.get(repo.id);
    if (installed) {
      if (satisfiesAll(installed.version, ranges)) {
        const parsed = safeJsonParseOrDefault<TakopackManifest | null>(installed.manifestJson, null);
        const deps = normalizeDependencies(parsed?.dependencies);
        return {
          repoId: repo.id,
          repoRef: `@${repo.owner_username}/${repo.name}`,
          name: installed.name,
          appId: installed.appId,
          version: installed.version,
          source: 'installed',
          dependencies: deps,
        };
      }

      if (installed.isPinned) {
        throw new Error(
          `Dependency ${repo.owner_username}/${repo.name} is pinned at ${installed.version} and does not satisfy required range(s)`
        );
      }
    }

    const candidates = await this.getReleaseCandidates(repo);
    const match = candidates.find((c) => satisfiesAll(c.version, ranges));
    if (!match) {
      const rangesStr = ranges.map((r) => r.raw).join(', ');
      throw new Error(
        `No compatible release found for dependency ${repo.owner_username}/${repo.name} (required: ${rangesStr})`
      );
    }

    if (installed) {
      const delta = compareSemver(installed.version, match.version);
      if (delta > 0) {
        throw new Error(
          `Dependency ${repo.owner_username}/${repo.name} would require a downgrade (${installed.version} -> ${match.version}), which is not supported`
        );
      }
    }

    return match;
  }

  async seedRootDependencies(
    rootDependencies: NonNullable<TakopackManifest['dependencies']>,
  ): Promise<void> {
    this.outgoingBySource.set(ROOT_DEP_SOURCE_KEY, []);
    for (const dep of rootDependencies) {
      const repo = await this.resolveRepoRef(dep.repo);
      await this.ensureRepoAccessible(repo.id, repo.visibility);
      this.setConstraint(repo.id, ROOT_DEP_SOURCE_KEY, makeRangeSpec(dep.version), dep.repo);
      getOrThrow(this.outgoingBySource, ROOT_DEP_SOURCE_KEY, 'Root dependency source not initialized').push({
        targetRepoId: repo.id,
        range: makeRangeSpec(dep.version),
        repoRef: dep.repo,
      });
    }
  }

  async resolve(): Promise<void> {
    while (this.pending.size > 0) {
      const [repoId] = this.pending;
      this.pending.delete(repoId);

      const constraints = this.constraintsByTarget.get(repoId);
      if (!constraints || constraints.size === 0) continue;

      const repo = await this.lookupRepoById(repoId);

      const ranges = Array.from(constraints.values());
      const next = await this.selectCandidate(repo, ranges);
      const prev = this.selected.get(repoId);
      if (prev && prev.source === next.source && prev.version === next.version && prev.assetId === next.assetId) {
        continue;
      }

      this.removeOutgoingConstraints(repoId);
      this.selected.set(repoId, next);

      const newEdges: DepEdge[] = [];
      for (const dep of next.dependencies) {
        const depRepo = await this.resolveRepoRef(dep.repo);
        await this.ensureRepoAccessible(depRepo.id, depRepo.visibility);
        const r = makeRangeSpec(dep.version);
        this.setConstraint(depRepo.id, repoId, r, dep.repo);
        newEdges.push({ targetRepoId: depRepo.id, range: r, repoRef: dep.repo });
      }
      this.outgoingBySource.set(repoId, newEdges);
    }
  }

  getInstallOrder(): string[] {
    return topologicalSort(this.selected, this.outgoingBySource);
  }

  getSelected(): Map<string, DependencyCandidate> {
    return this.selected;
  }

  private async lookupRepoById(repoId: string): Promise<RepoLookup> {
    for (const v of this.repoRefCache.values()) {
      if (v.id === repoId) return v;
    }

    const r = await this.db.select({
      id: repositories.id,
      name: repositories.name,
      visibility: repositories.visibility,
      accountId: repositories.accountId,
    }).from(repositories).where(eq(repositories.id, repoId)).get();

    if (!r) {
      throw new Error('Repository not found');
    }

    const ownerAccount = await this.db.select({
      slug: accounts.slug,
      name: accounts.name,
    }).from(accounts).where(eq(accounts.id, r.accountId)).get();

    const ownerUsername = ownerAccount
      ? (ownerAccount.slug || ownerAccount.name)
      : null;
    if (!ownerUsername) {
      throw new Error('Repository not found');
    }
    return { id: r.id, name: r.name, visibility: r.visibility, owner_username: ownerUsername };
  }
}
