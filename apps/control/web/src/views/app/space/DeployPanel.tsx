import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { useToast } from "../../../store/toast.ts";
import { useConfirmDialog } from "../../../store/confirm-dialog.ts";
import { Icons } from "../../../lib/Icons.tsx";
import { rpc, rpcJson, rpcPath } from "../../../lib/rpc.ts";
import type { TranslationKey } from "../../../i18n.ts";
import {
  DEPLOY_NAV_SECTIONS,
  type DeploySection,
  type Resource,
  type Space,
  type User,
  type UserSettings,
  type Worker,
} from "../../../types/index.ts";
import { WorkersTab } from "../../workers/tabs/WorkersTab.tsx";
import { ResourcesTab } from "../../workers/tabs/ResourcesTab.tsx";
import { WorkerDetailContainer } from "../../workers/detail/WorkerDetailContainer.tsx";
import { ResourceDetailContainer } from "../../workers/detail/ResourceDetailContainer.tsx";
import { CreateResourceModal } from "../../workers/modals/CreateResourceModal.tsx";
import { useSpaceWorkers } from "../../../hooks/useSpaceWorkers.ts";
import { useSpaceResources } from "../../../hooks/useSpaceResources.ts";

interface DeployPanelProps {
  spaceId: string;
  spaces?: Space[];
  activeSection: DeploySection;
  onSectionChange?: (section: DeploySection) => void;
  onClose?: () => void;
  user: User | null;
  userSettings: UserSettings | null;
  onSettingsChange?: (settings: UserSettings) => void;
  onSpacesRefresh?: () => void;
  isMobile?: boolean;
}

type DeployNavSection = (typeof DEPLOY_NAV_SECTIONS)[number];

const DEPLOY_SECTION_META: Record<
  DeployNavSection,
  { icon: JSX.Element; labelKey: TranslationKey }
> = {
  workers: { icon: <Icons.Server class="w-3.5 h-3.5" />, labelKey: "workers" },
  resources: {
    icon: <Icons.Database class="w-3.5 h-3.5" />,
    labelKey: "resources",
  },
};

const SECTIONS: {
  id: DeploySection;
  icon: JSX.Element;
  labelKey: TranslationKey;
}[] = DEPLOY_NAV_SECTIONS.map((id) => ({
  id,
  ...DEPLOY_SECTION_META[id],
}));

export function DeployPanel({
  spaceId,
  spaces: _spaces = [],
  activeSection,
  onSectionChange,
  onClose,
  user: _user,
  userSettings: _userSettings,
  onSettingsChange: _onSettingsChange,
  onSpacesRefresh: _onSpacesRefresh,
  isMobile: _isMobile = false,
}: DeployPanelProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const {
    cfWorkers: workers,
    setCfWorkers,
    loadingCfWorkers: loadingWorkers,
    refreshWorkers,
    deleteWorker,
  } = useSpaceWorkers(spaceId);
  const [selectedWorker, setSelectedWorker] = createSignal<Worker | null>(null);
  const [workerTab, setWorkerTab] = createSignal<
    import("../../workers/worker-models.ts").WorkerDetailTab
  >("overview");

  const { resources, loadingResources, refreshResources } = useSpaceResources(
    spaceId,
  );
  const [selectedResource, setSelectedResource] = createSignal<Resource | null>(
    null,
  );
  const [showCreateResource, setShowCreateResource] = createSignal(false);
  const [newResourceName, setNewResourceName] = createSignal("");
  const [newResourceType, setNewResourceType] = createSignal<Resource["type"]>(
    "d1",
  );
  const [creatingResource, setCreatingResource] = createSignal(false);
  const [resourceTab, setResourceTab] = createSignal<
    "overview" | "explorer" | "browser" | "bindings" | "settings"
  >("overview");

  const handleSectionChange = (section: DeploySection) => {
    setSelectedWorker(null);
    setSelectedResource(null);
    onSectionChange?.(section);
  };

  const handleCreateResource = async () => {
    setCreatingResource(true);
    try {
      const res = await rpcPath(rpc, "resources").$post({
        param: {},
        json: {
          name: newResourceName,
          type: newResourceType,
          space_id: spaceId,
        },
      });
      await rpcJson(res);
      showToast("success", t("resourceCreated"));
      setShowCreateResource(false);
      setNewResourceName("");
      setNewResourceType("d1");
      refreshResources();
    } catch {
      showToast("error", t("failedToCreate"));
    } finally {
      setCreatingResource(false);
    }
  };

  const handleDeleteResource = async () => {
    if (!selectedResource) return;
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("deleteResourceWarning"),
      confirmText: t("delete"),
      danger: true,
    });
    if (confirmed) {
      try {
        const res = await rpcPath(rpc, "resources", "by-name", ":name").$delete(
          {
            param: { name: selectedResource.name },
          },
        );
        await rpcJson(res);
        showToast("success", t("resourceDeleted"));
        setSelectedResource(null);
        refreshResources();
      } catch {
        showToast("error", t("failedToDelete"));
      }
    }
  };

  // Detail views rendered full-page (no centering constraint)
  if (activeSection === "workers" && selectedWorker()) {
    return (
      <div class="flex flex-col flex-1 h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
        <WorkerDetailContainer
          worker={selectedWorker()!}
          tab={workerTab()}
          resources={resources()}
          onBack={() => {
            setSelectedWorker(null);
            setWorkerTab("overview");
          }}
          onTabChange={setWorkerTab}
          onDeleteWorker={async (worker) => {
            const deleted = await deleteWorker(worker);
            if (deleted) {
              setSelectedWorker(null);
              setWorkerTab("overview");
            }
          }}
          onWorkerUpdated={(workerId, updates) => {
            setCfWorkers((prev) =>
              prev.map((w) => w.id === workerId ? { ...w, ...updates } : w)
            );
            setSelectedWorker((prev) =>
              prev && prev.id === workerId ? { ...prev, ...updates } : prev
            );
          }}
          onRefreshWorkers={refreshWorkers}
        />
      </div>
    );
  }

  if (activeSection === "resources" && selectedResource()) {
    return (
      <div class="flex flex-col flex-1 h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
        <ResourceDetailContainer
          resource={selectedResource()!}
          tab={resourceTab()}
          onTabChange={setResourceTab}
          onBack={() => setSelectedResource(null)}
          onDeleteResource={() => handleDeleteResource()}
        />
      </div>
    );
  }

  const renderSectionContent = () => {
    switch (activeSection) {
      case "workers":
        return (
          <WorkersTab
            workers={workers()}
            loading={loadingWorkers()}
            onSelectWorker={setSelectedWorker}
          />
        );

      case "resources":
        return (
          <>
            <ResourcesTab
              resources={resources()}
              loading={loadingResources()}
              onSelectResource={(r) => {
                setSelectedResource(r);
                setResourceTab("overview");
              }}
              onCreateResource={() => setShowCreateResource(true)}
            />
            {showCreateResource() && (
              <CreateResourceModal
                onClose={() => setShowCreateResource(false)}
                onCreate={handleCreateResource}
                resourceName={newResourceName()}
                onResourceNameChange={setNewResourceName}
                resourceType={newResourceType()}
                onResourceTypeChange={setNewResourceType}
                creating={creatingResource()}
              />
            )}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div class="flex flex-col flex-1 h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div class="flex-1 overflow-hidden">
        <div class="h-full overflow-y-auto">
          <div class="max-w-3xl mx-auto w-full px-4">
            <div class="flex items-center gap-3 pt-8 pb-5">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex-1">
                {t("deployNav")}
              </h1>
              {onClose && (
                <button
                  type="button"
                  class="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 transition-colors"
                  onClick={onClose}
                  aria-label={t("close")}
                >
                  <Icons.X class="w-4 h-4" />
                </button>
              )}
            </div>

            <div class="flex gap-2 pb-6 flex-wrap">
              {SECTIONS.map((section) => (
                <button
                  type="button"
                  onClick={() => handleSectionChange(section.id)}
                  class={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeSection === section.id
                      ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  }`}
                >
                  {section.icon}
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
            </div>

            <div class="pb-10">
              {renderSectionContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
