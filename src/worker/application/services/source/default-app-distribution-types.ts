import type {
  defaultAppDistributionConfig,
  defaultAppDistributionEntries,
  defaultAppPreinstallJobs,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";

export type DefaultAppRefType = "branch" | "tag" | "commit";
export type DefaultAppBackend =
  | "cloudflare"
  | "local"
  | "aws"
  | "gcp"
  | "k8s";
export type DefaultAppRuntimeMode =
  | "shared-cell"
  | "dedicated"
  | "self-hosted";
export type DefaultAppBindingType =
  | "identity.oidc@v1"
  | "database.postgres@v1"
  | "object-store.s3-compatible@v1"
  | "domain.http@v1"
  | "install-launch-token@v1";

export interface DefaultAppBindingSummary {
  name: string;
  type: DefaultAppBindingType;
  required: boolean;
}

export interface DefaultAppDistributionEntry {
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
  refType: DefaultAppRefType;
  sourcePath?: string;
  runtimeModes?: DefaultAppRuntimeMode[];
  bindings?: DefaultAppBindingSummary[];
  preinstall: boolean;
  backendName?: DefaultAppBackend;
  envName?: string;
}

export type DefaultAppDistributionEnv = Pick<
  Env,
  | "DB"
  | "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON"
  | "TAKOS_DEFAULT_APP_REPOSITORIES_JSON"
  | "TAKOS_DEFAULT_APPS_PREINSTALL"
  | "TAKOS_DEFAULT_APP_REF"
  | "TAKOS_DEFAULT_APP_REF_TYPE"
  | "TAKOS_DEFAULT_APP_BACKEND"
  | "TAKOS_DEFAULT_APP_ENV"
  | "TAKOS_DEFAULT_APP_INSTALL_URL"
  | "TAKOS_DEFAULT_APP_INSTALL_TOKEN"
  | "TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID"
  | "TAKOS_DEFAULT_APP_INSTALL_SUBJECT"
  | "TAKOS_DEFAULT_APP_INSTALL_MODE"
  | "TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL"
  | "TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_ROAD_TO_ME_APP_REPOSITORY_URL"
>;

export type DefaultAppDistributionDefaults = {
  preinstall: boolean;
  ref: string;
  refFromEnv: boolean;
  refType: DefaultAppRefType;
  backendName?: DefaultAppBackend;
  envName?: string;
};

export type DefaultAppDistributionRow =
  typeof defaultAppDistributionEntries.$inferSelect;
export type DefaultAppDistributionConfigRow =
  typeof defaultAppDistributionConfig.$inferSelect;
export type DefaultAppPreinstallJobRow =
  typeof defaultAppPreinstallJobs.$inferSelect;

export type DefaultAppInstallConfig = {
  installUrl: string;
  token: string;
  subject: string;
  accountId?: string;
  mode?: string;
  runtimeBaseUrl?: string;
};

export type DefaultAppPreinstallJobStatus =
  | "queued"
  | "in_progress"
  | "blocked_by_config"
  | "paused_by_operator"
  | "completed"
  | "failed";

export interface DefaultAppPreinstallJobSummary {
  scanned: number;
  processed: number;
  completed: number;
  blocked: number;
  paused: number;
  requeued: number;
  failed: number;
}

export type DefaultAppDistributionStatusSource =
  | "disabled"
  | "env_distribution"
  | "env_repositories"
  | "db"
  | "fallback";

export interface DefaultAppDistributionStatus {
  source: DefaultAppDistributionStatusSource;
  preinstallEnabled: boolean;
  entries: DefaultAppDistributionEntry[];
  totalEntries: number;
  preinstallEntries: number;
}

export interface DefaultAppPreinstallJobsStatus {
  available: boolean;
  total: number;
  byStatus: Record<DefaultAppPreinstallJobStatus, number>;
  latestUpdatedAt: string | null;
  lastErrors: Array<{
    id: string;
    spaceId: string;
    status: DefaultAppPreinstallJobStatus;
    lastError: string;
    updatedAt: string | null;
  }>;
  error?: string;
}

export interface DefaultAppReconcileStatus {
  distribution: DefaultAppDistributionStatus;
  jobs: DefaultAppPreinstallJobsStatus;
}
