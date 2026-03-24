import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { nowIso } from './schema-helpers';

// 24. Blob
export const blobs = sqliteTable('blobs', {
  accountId: text('account_id').notNull(),
  hash: text('hash').notNull(),
  size: integer('size').notNull(),
  isBinary: integer('is_binary', { mode: 'boolean' }).notNull().default(false),
  refcount: integer('refcount').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  pk: primaryKey({ columns: [table.accountId, table.hash] }),
  idxRefcount: index('idx_blobs_refcount').on(table.refcount),
}));

// 25. Branch
export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  name: text('name').notNull(),
  commitSha: text('commit_sha').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isProtected: integer('is_protected', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  uniqRepoName: uniqueIndex('idx_branches_repo_name').on(table.repoId, table.name),
  idxRepo: index('idx_branches_repo_id').on(table.repoId),
  idxCommitSha: index('idx_branches_commit_sha').on(table.commitSha),
}));

// 28. Chunk
export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull(),
  accountId: text('account_id').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  content: text('content').notNull(),
  vectorId: text('vector_id'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxVector: index('idx_chunks_vector_id').on(table.vectorId),
  idxFile: index('idx_chunks_file_id').on(table.fileId),
  idxAccount: index('idx_chunks_account_id').on(table.accountId),
}));

// 29. Commit
export const commits = sqliteTable('commits', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  sha: text('sha').notNull(),
  treeSha: text('tree_sha').notNull(),
  parentShas: text('parent_shas'),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email').notNull(),
  authorDate: text('author_date').notNull(),
  committerName: text('committer_name').notNull(),
  committerEmail: text('committer_email').notNull(),
  commitDate: text('commit_date').notNull(),
  message: text('message').notNull(),
}, (table) => ({
  uniqRepoSha: uniqueIndex('idx_commits_repo_sha').on(table.repoId, table.sha),
  idxTreeSha: index('idx_commits_tree_sha').on(table.treeSha),
  idxSha: index('idx_commits_sha').on(table.sha),
  idxRepo: index('idx_commits_repo_id').on(table.repoId),
  idxRepoCommitDate: index('idx_commits_repo_commit_date').on(table.repoId, table.commitDate),
}));

// 38. File
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  path: text('path').notNull(),
  sha256: text('sha256'),
  mimeType: text('mime_type'),
  size: integer('size').notNull().default(0),
  origin: text('origin').notNull().default('user'),
  kind: text('kind').notNull().default('source'),
  visibility: text('visibility').notNull().default('private'),
  indexedAt: text('indexed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  uniqAccountPath: uniqueIndex('idx_files_account_path').on(table.accountId, table.path),
  idxSha256: index('idx_files_sha256').on(table.sha256),
  idxOrigin: index('idx_files_origin').on(table.origin),
  idxKind: index('idx_files_kind').on(table.kind),
  idxAccount: index('idx_files_account_id').on(table.accountId),
}));

// 39. GitCommit
export const gitCommits = sqliteTable('git_commits', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  message: text('message').notNull(),
  authorAccountId: text('author_account_id').notNull(),
  authorName: text('author_name').notNull(),
  parentId: text('parent_id'),
  filesChanged: integer('files_changed').notNull().default(0),
  insertions: integer('insertions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
  treeHash: text('tree_hash').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxParent: index('idx_git_commits_parent_id').on(table.parentId),
  idxCreatedAt: index('idx_git_commits_created_at').on(table.createdAt),
  idxAuthor: index('idx_git_commits_author_account_id').on(table.authorAccountId),
  idxAccount: index('idx_git_commits_account_id').on(table.accountId),
}));

// 40. GitFileChange
export const gitFileChanges = sqliteTable('git_file_changes', {
  id: text('id').primaryKey(),
  commitId: text('commit_id').notNull(),
  fileId: text('file_id'),
  path: text('path').notNull(),
  changeType: text('change_type').notNull(),
  oldPath: text('old_path'),
  oldHash: text('old_hash'),
  newHash: text('new_hash'),
  insertions: integer('insertions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
}, (table) => ({
  idxPath: index('idx_git_file_changes_path').on(table.path),
  idxFile: index('idx_git_file_changes_file_id').on(table.fileId),
  idxCommit: index('idx_git_file_changes_commit_id').on(table.commitId),
}));

// 41. IndexJob
export const indexJobs = sqliteTable('index_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  type: text('type').notNull(),
  targetId: text('target_id'),
  status: text('status').notNull().default('queued'),
  totalFiles: integer('total_files').notNull().default(0),
  processedFiles: integer('processed_files').notNull().default(0),
  error: text('error'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxStatus: index('idx_index_jobs_status').on(table.status),
  idxAccount: index('idx_index_jobs_account_id').on(table.accountId),
}));

// 69. PrComment
export const prComments = sqliteTable('pr_comments', {
  id: text('id').primaryKey(),
  prId: text('pr_id').notNull(),
  authorType: text('author_type').notNull().default('ai'),
  authorId: text('author_id'),
  content: text('content').notNull(),
  filePath: text('file_path'),
  lineNumber: integer('line_number'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxPr: index('idx_pr_comments_pr_id').on(table.prId),
  idxFilePath: index('idx_pr_comments_file_path').on(table.filePath),
  idxAuthorTypeId: index('idx_pr_comments_author_type_id').on(table.authorType, table.authorId),
}));

// 70. PrReview
export const prReviews = sqliteTable('pr_reviews', {
  id: text('id').primaryKey(),
  prId: text('pr_id').notNull(),
  reviewerType: text('reviewer_type').notNull().default('ai'),
  reviewerId: text('reviewer_id'),
  status: text('status').notNull(),
  body: text('body'),
  analysis: text('analysis'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxStatus: index('idx_pr_reviews_status').on(table.status),
  idxReviewerTypeId: index('idx_pr_reviews_reviewer_type_id').on(table.reviewerType, table.reviewerId),
  idxPr: index('idx_pr_reviews_pr_id').on(table.prId),
}));

// 71. PullRequest
export const pullRequests = sqliteTable('pull_requests', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  headBranch: text('head_branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  status: text('status').notNull().default('open'),
  authorType: text('author_type').notNull().default('agent'),
  authorId: text('author_id'),
  runId: text('run_id'),
  mergedAt: text('merged_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  uniqRepoNumber: uniqueIndex('idx_pull_requests_repo_number').on(table.repoId, table.number),
  idxStatus: index('idx_pull_requests_status').on(table.status),
  idxRun: index('idx_pull_requests_run_id').on(table.runId),
  idxRepo: index('idx_pull_requests_repo_id').on(table.repoId),
  idxAuthorTypeId: index('idx_pull_requests_author_type_id').on(table.authorType, table.authorId),
}));

// 73. RepoFork
export const repoForks = sqliteTable('repo_forks', {
  id: text('id').primaryKey(),
  forkRepoId: text('fork_repo_id').notNull().unique(),
  upstreamRepoId: text('upstream_repo_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxUpstream: index('idx_repo_forks_upstream_repo_id').on(table.upstreamRepoId),
  idxFork: index('idx_repo_forks_fork_repo_id').on(table.forkRepoId),
}));

// 74. RepoReleaseAsset
export const repoReleaseAssets = sqliteTable('repo_release_assets', {
  id: text('id').primaryKey(),
  releaseId: text('release_id').notNull(),
  assetKey: text('asset_key').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  checksumSha256: text('checksum_sha256'),
  downloadCount: integer('download_count').notNull().default(0),
  bundleFormat: text('bundle_format'),
  bundleMetaJson: text('bundle_meta_json'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  uniqReleaseAssetKey: uniqueIndex('idx_repo_release_assets_release_asset_key').on(table.releaseId, table.assetKey),
  idxRelease: index('idx_repo_release_assets_release_id').on(table.releaseId),
}));

// 75. RepoRelease
export const repoReleases = sqliteTable('repo_releases', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  tag: text('tag').notNull(),
  name: text('name'),
  description: text('description'),
  commitSha: text('commit_sha'),
  isPrerelease: integer('is_prerelease', { mode: 'boolean' }).notNull().default(false),
  isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
  downloads: integer('downloads').notNull().default(0),
  authorAccountId: text('author_account_id'),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  uniqRepoTag: uniqueIndex('idx_repo_releases_repo_tag').on(table.repoId, table.tag),
  idxTag: index('idx_repo_releases_tag').on(table.tag),
  idxRepo: index('idx_repo_releases_repo_id').on(table.repoId),
  idxPublishedAt: index('idx_repo_releases_published_at').on(table.publishedAt),
}));

// 76. RepoRemote
export const repoRemotes = sqliteTable('repo_remotes', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  name: text('name').notNull().default('upstream'),
  upstreamRepoId: text('upstream_repo_id').notNull().default(''),
  /** External git URL (for repos imported from external servers). */
  url: text('url'),
  /** Timestamp of the last successful fetch from the remote. */
  lastFetchedAt: text('last_fetched_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  uniqRepoName: uniqueIndex('idx_repo_remotes_repo_name').on(table.repoId, table.name),
  idxRepo: index('idx_repo_remotes_repo_id').on(table.repoId),
}));

// 77. RepoStar
export const repoStars = sqliteTable('repo_stars', {
  accountId: text('account_id').notNull(),
  repoId: text('repo_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  pk: primaryKey({ columns: [table.accountId, table.repoId] }),
  idxRepo: index('idx_repo_stars_repo_id').on(table.repoId),
  idxAccount: index('idx_repo_stars_account_id').on(table.accountId),
}));

// 79. Repository
export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  visibility: text('visibility').notNull().default('private'),
  defaultBranch: text('default_branch').notNull().default('main'),
  forkedFromId: text('forked_from_id'),
  remoteCloneUrl: text('remote_clone_url'),
  remoteStoreActorUrl: text('remote_store_actor_url'),
  stars: integer('stars').notNull().default(0),
  forks: integer('forks').notNull().default(0),
  gitEnabled: integer('git_enabled', { mode: 'boolean' }).notNull().default(false),
  isOfficial: integer('is_official', { mode: 'boolean' }).notNull().default(false),
  officialCategory: text('official_category'),
  officialMaintainer: text('official_maintainer'),
  primaryLanguage: text('primary_language'),
  license: text('license'),
  featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
  installCount: integer('install_count').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  uniqAccountName: uniqueIndex('idx_repositories_account_name').on(table.accountId, table.name),
  idxVisibilityUpdatedAt: index('idx_repositories_visibility_updated_at').on(table.visibility, table.updatedAt),
  idxVisibility: index('idx_repositories_visibility').on(table.visibility),
  idxPrimaryLanguage: index('idx_repositories_primary_language').on(table.primaryLanguage),
  idxOfficialCategory: index('idx_repositories_official_category').on(table.officialCategory),
  idxLicense: index('idx_repositories_license').on(table.license),
  idxIsOfficial: index('idx_repositories_is_official').on(table.isOfficial),
  idxForkedFrom: index('idx_repositories_forked_from_id').on(table.forkedFromId),
  idxFeatured: index('idx_repositories_featured').on(table.featured),
  idxAccountVisibility: index('idx_repositories_account_visibility').on(table.accountId, table.visibility),
  idxAccount: index('idx_repositories_account_id').on(table.accountId),
}));

// 93. Snapshot
export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  parentIds: text('parent_ids'),
  treeKey: text('tree_key').notNull(),
  message: text('message'),
  author: text('author'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxStatus: index('idx_snapshots_status').on(table.status),
  idxAccount: index('idx_snapshots_account_id').on(table.accountId),
}));

// 94. Tag
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  name: text('name').notNull(),
  commitSha: text('commit_sha').notNull(),
  message: text('message'),
  taggerName: text('tagger_name'),
  taggerEmail: text('tagger_email'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  uniqRepoName: uniqueIndex('idx_tags_repo_name').on(table.repoId, table.name),
  idxRepo: index('idx_tags_repo_id').on(table.repoId),
  idxCommitSha: index('idx_tags_commit_sha').on(table.commitSha),
}));
