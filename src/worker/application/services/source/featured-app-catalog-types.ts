import type {
  featuredAppCatalogConfig,
  featuredAppCatalogEntries,
  featuredAppPreinstallJobs,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";

export type FeaturedAppRefType = "branch" | "tag" | "commit";
export type FeaturedAppBackend = "cloudflare" | "local" | "aws" | "gcp" | "k8s";
export type FeaturedAppRuntimeMode = "shared-cell" | "dedicated" | "self-hosted";
export type FeaturedAppVariableValue =
  | string
  | number
  | boolean
  | null
  | FeaturedAppVariableValue[]
  | { [key: string]: FeaturedAppVariableValue };
export type FeaturedAppServiceBindingType =
  | "identity.oidc"
  | "storage.sql"
  | "storage.object"
  | "protocol.http.api"
  | "auth.bootstrap_token";

export interface FeaturedAppServiceBindingSummary {
  name: string;
  type: FeaturedAppServiceBindingType;
  required: boolean;
}

export interface FeaturedAppCatalogEntry {
  name: string;
  title: string;
  appId?: string;
  description?: string;
  publisher?: string;
  homepage?: string;
  icon?: string;
  category?: "app" | "service" | "library" | "template" | "social";
  tags?: string[];
  repositoryUrl: string;
  ref: string;
  refType: FeaturedAppRefType;
  sourcePath?: string;
  modulePath?: string;
  variables?: Record<string, FeaturedAppVariableValue>;
  runtimeModes?: FeaturedAppRuntimeMode[];
  bindings?: FeaturedAppServiceBindingSummary[];
  preinstall: boolean;
  backendName?: FeaturedAppBackend;
  envName?: string;
}

export type FeaturedAppCatalogEnv = Pick<
  Env,
  | "DB"
  | "TAKOS_FEATURED_APP_CATALOG_JSON"
  | "TAKOS_FEATURED_APP_REPOSITORIES_JSON"
  | "TAKOS_FEATURED_APPS_PREINSTALL"
  | "TAKOS_FEATURED_APP_REF"
  | "TAKOS_FEATURED_APP_REF_TYPE"
  | "TAKOS_FEATURED_APP_BACKEND"
  | "TAKOS_FEATURED_APP_ENV"
  | "TAKOS_FEATURED_APP_INSTALL_URL"
  | "TAKOS_FEATURED_APP_INSTALL_TOKEN"
  | "TAKOS_FEATURED_APP_INSTALL_ACCOUNT_ID"
  | "TAKOS_FEATURED_APP_INSTALL_SUBJECT"
  | "TAKOS_FEATURED_APP_INSTALL_MODE"
  | "TAKOS_FEATURED_APP_INSTALL_RUNTIME_BASE_URL"
  | "TAKOS_APP_INSTALLATIONS_URL"
  | "TAKOS_APP_INSTALL_TOKEN"
  | "TAKOS_APP_INSTALL_ACCOUNT_ID"
  | "TAKOS_APP_INSTALL_SUBJECT"
  | "TAKOS_APP_INSTALL_MODE"
  | "TAKOS_APP_INSTALL_RUNTIME_BASE_URL"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
  | "TAKOSUMI_ACCOUNTS_URL"
  | "TAKOSUMI_ACCOUNTS_TOKEN"
  | "TAKOSUMI_ACCOUNTS_SUBJECT"
>;

export type FeaturedAppCatalogDefaults = {
  preinstall: boolean;
  ref: string;
  refFromEnv: boolean;
  refType: FeaturedAppRefType;
  backendName?: FeaturedAppBackend;
  envName?: string;
};

export type FeaturedAppCatalogRow =
  typeof featuredAppCatalogEntries.$inferSelect;
export type FeaturedAppCatalogConfigRow =
  typeof featuredAppCatalogConfig.$inferSelect;
export type FeaturedAppPreinstallJobRow =
  typeof featuredAppPreinstallJobs.$inferSelect;

export type FeaturedAppInstallConfig = {
  installUrl: string;
  token: string;
  subject: string;
  accountId?: string;
  mode?: string;
  runtimeBaseUrl?: string;
};

export type FeaturedAppPreinstallJobStatus =
  | "queued"
  | "in_progress"
  | "blocked_by_config"
  | "paused_by_operator"
  | "completed"
  | "failed";

export interface FeaturedAppPreinstallJobSummary {
  scanned: number;
  processed: number;
  completed: number;
  blocked: number;
  paused: number;
  requeued: number;
  failed: number;
}

export type FeaturedAppCatalogStatusSource =
  | "disabled"
  | "env_catalog"
  | "env_repositories"
  | "db"
  | "fallback";

export interface FeaturedAppCatalogStatus {
  source: FeaturedAppCatalogStatusSource;
  preinstallEnabled: boolean;
  entries: FeaturedAppCatalogEntry[];
  totalEntries: number;
  preinstallEntries: number;
}

export interface FeaturedAppPreinstallJobsStatus {
  available: boolean;
  total: number;
  byStatus: Record<FeaturedAppPreinstallJobStatus, number>;
  latestUpdatedAt: string | null;
  lastErrors: Array<{
    id: string;
    spaceId: string;
    status: FeaturedAppPreinstallJobStatus;
    lastError: string;
    updatedAt: string | null;
  }>;
  error?: string;
}

export interface FeaturedAppReconcileStatus {
  catalog: FeaturedAppCatalogStatus;
  jobs: FeaturedAppPreinstallJobsStatus;
}
