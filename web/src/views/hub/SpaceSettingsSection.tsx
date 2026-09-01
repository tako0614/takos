import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { getErrorMessage } from "../../lib/errors.ts";
import { findSpaceByIdentifier, splitSpaces } from "../../lib/spaces.ts";
import { createClientOperationId } from "../../lib/client-operation-id.ts";
import type { Space } from "../../types/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import { CreateSpaceModal } from "../shared/spaces/CreateSpaceModal.tsx";
import {
  DangerZoneCard,
  PersonalSpaceNote,
  SecurityPostureCard,
  SpaceInfoCard,
} from "./SpaceSettingsCards.tsx";
import {
  buildWorkspaceDeletionRequest,
  parseWorkspaceDeletionResponse,
  parseWorkspaceMutationResponseFor,
} from "./workspace-response.ts";

interface SpaceSettingsSectionProps {
  spaces: Space[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string | null) => void;
  onSpaceDeleted?: () => void | Promise<void>;
  onSpaceUpdated?: () => void | Promise<void>;
}

type SettingsSaveKind = "details" | "security";

interface SettingsSaveOperation {
  spaceId: string;
  kind: SettingsSaveKind;
}

export function SpaceSettingsSection(props: SpaceSettingsSectionProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const selectedSpaceId = () => props.selectedSpaceId;

  const [spaceName, setSpaceName] = createSignal("");
  const [spaceDescription, setSpaceDescription] = createSignal("");
  const [isPersonal, setIsPersonal] = createSignal(false);
  const [securityPosture, setSecurityPosture] = createSignal<
    Space["security_posture"]
  >("standard");
  const [saveOperation, setSaveOperation] = createSignal<
    SettingsSaveOperation | null
  >(null);
  const [deletingSpaceId, setDeletingSpaceId] = createSignal<string | null>(
    null,
  );
  const settingsBusy = createMemo(() =>
    saveOperation() !== null || deletingSpaceId() !== null
  );

  const [showCreateSpace, setShowCreateSpace] = createSignal(false);
  let pendingDeletion: {
    spaceId: string;
    workspaceName: string;
    operationId: string;
  } | null = null;

  const groupedSpaces = createMemo(() =>
    splitSpaces(props.spaces || [], t("personal"))
  );
  const personalSpace = createMemo(() => groupedSpaces().personalSpace);
  const otherSpaces = createMemo(() => groupedSpaces().otherSpaces);
  const selectedSpace = createMemo(() => {
    const id = selectedSpaceId();
    return id
      ? findSpaceByIdentifier(props.spaces || [], id, t("personal"))
      : null;
  });
  const ownsSelectedSpace = createMemo(() =>
    selectedSpace() !== null
  );

  createEffect(() => {
    const space = selectedSpace();
    if (space) {
      setSpaceName(space.name as string);
      setSpaceDescription(space.description ?? "");
      setIsPersonal(space.is_default);
      setSecurityPosture(space.security_posture);
    } else {
      setSpaceName("");
      setSpaceDescription("");
      setIsPersonal(false);
      setSecurityPosture("standard");
    }
  });

  const handleSaveSpace = async () => {
    const targetSpaceId = selectedSpaceId();
    const targetSpace = selectedSpace();
    const nextName = spaceName().trim();
    const nextDescription = spaceDescription().trim();
    if (
      !targetSpaceId || !targetSpace || !nextName || settingsBusy() ||
      !ownsSelectedSpace()
    ) return;
    const operation: SettingsSaveOperation = {
      spaceId: targetSpace.id,
      kind: "details",
    };
    try {
      setSaveOperation(operation);
      const res = await rpc.spaces[":spaceId"].$patch({
        param: { spaceId: targetSpaceId },
        json: {
          name: nextName,
          description: nextDescription || null,
        },
      });
      parseWorkspaceMutationResponseFor(await rpcJson<unknown>(res), {
        id: targetSpace.id,
        name: nextName,
        description: nextDescription || null,
      });
      showToast("success", t("saved"));
      try {
        await props.onSpaceUpdated?.();
      } catch {
        showToast("error", t("workspaceSavedRefreshFailed"));
      }
    } catch {
      showToast("error", t("failedToSave"));
    } finally {
      const current = saveOperation();
      if (
        current?.spaceId === operation.spaceId &&
        current.kind === operation.kind
      ) setSaveOperation(null);
    }
  };

  const handleSaveSecurityPosture = async () => {
    const targetSpaceId = selectedSpaceId();
    const targetSpace = selectedSpace();
    const nextSecurityPosture = securityPosture();
    if (
      !targetSpaceId || !targetSpace || settingsBusy() ||
      !ownsSelectedSpace() ||
      nextSecurityPosture === targetSpace.security_posture
    ) return;
    const operation: SettingsSaveOperation = {
      spaceId: targetSpace.id,
      kind: "security",
    };
    try {
      setSaveOperation(operation);
      const res = await rpc.spaces[":spaceId"].$patch({
        param: { spaceId: targetSpaceId },
        json: { security_posture: nextSecurityPosture },
      });
      parseWorkspaceMutationResponseFor(await rpcJson<unknown>(res), {
        id: targetSpace.id,
        securityPosture: nextSecurityPosture,
      });
      showToast("success", t("saved"));
      try {
        await props.onSpaceUpdated?.();
      } catch {
        showToast("error", t("workspaceSavedRefreshFailed"));
      }
    } catch {
      if (selectedSpace()?.id === targetSpace.id) {
        setSecurityPosture(targetSpace.security_posture);
      }
      showToast("error", t("failedToSave"));
    } finally {
      const current = saveOperation();
      if (
        current?.spaceId === operation.spaceId &&
        current.kind === operation.kind
      ) setSaveOperation(null);
    }
  };

  const handleDeleteSpace = async () => {
    const targetSpaceIdentifier = selectedSpaceId();
    const targetSpace = selectedSpace();
    if (
      !targetSpaceIdentifier || !targetSpace || isPersonal() ||
      settingsBusy() ||
      !ownsSelectedSpace()
    ) return;
    const confirmed = await confirm({
      title: t("deleteSpace"),
      message: t("deleteSpaceWarning", { name: selectedSpace()?.name || "" }),
      confirmText: t("delete"),
      danger: true,
      confirmationText: selectedSpace()?.name,
      confirmationLabel: t("typeWorkspaceNameToConfirm"),
    });
    if (!confirmed) return;
    if (settingsBusy() || selectedSpace()?.id !== targetSpace.id) return;

    const canonicalSpaceId = targetSpace.id;
    try {
      setDeletingSpaceId(canonicalSpaceId);
      if (
        !pendingDeletion || pendingDeletion.spaceId !== canonicalSpaceId ||
        pendingDeletion.workspaceName !== targetSpace.name
      ) {
        pendingDeletion = {
          spaceId: canonicalSpaceId,
          workspaceName: targetSpace.name,
          operationId: createClientOperationId(),
        };
      }
      const request = buildWorkspaceDeletionRequest(
        targetSpace,
        pendingDeletion.operationId,
      );
      const res = await rpc.spaces[":spaceId"].$delete(request);
      parseWorkspaceDeletionResponse(await rpcJson<unknown>(res), {
        spaceId: canonicalSpaceId,
        operationId: pendingDeletion.operationId,
      });
      pendingDeletion = null;
      showToast("success", t("spaceDeleted"));
      props.setSelectedSpaceId(null);
      try {
        await props.onSpaceDeleted?.();
      } catch {
        showToast("error", t("workspaceDeletedRefreshFailed"));
      }
    } catch (err: unknown) {
      showToast("error", getErrorMessage(err, t("failedToDelete")));
    } finally {
      if (deletingSpaceId() === canonicalSpaceId) setDeletingSpaceId(null);
    }
  };

  const handleCreateSpace = async (
    name: string,
    description: string,
    installFeaturedApps: boolean,
    operationId: string,
  ) => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) return;
    let space: Space;
    try {
      const res = await rpc.spaces.$post({
        json: {
          name: trimmedName,
          description: trimmedDescription || undefined,
          installFeaturedApps,
          idempotency_key: operationId,
        },
      });
      space = parseWorkspaceMutationResponseFor(
        await rpcJson<unknown>(res),
        {
          isDefault: false,
          name: trimmedName,
          description: trimmedDescription || null,
        },
      );
    } catch (err: unknown) {
      throw new Error(getErrorMessage(err, t("failedToCreate")));
    }

    showToast("success", t("categoryCreated"));
    setShowCreateSpace(false);
    let refreshed = true;
    try {
      await props.onSpaceUpdated?.();
    } catch {
      refreshed = false;
      showToast("error", t("workspaceCreatedRefreshFailed"));
    }
    if (refreshed) props.setSelectedSpaceId(space.slug ?? null);
  };

  return (
    <div class="h-full flex flex-col bg-zinc-50/30 dark:bg-zinc-900/30">
      <div class="flex items-center gap-3 px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          <Icons.Settings class="w-4 h-4" />
        </div>
        <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t("categoryManagement")}
        </h3>
      </div>

      <div class="px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="flex items-center justify-between mb-2">
          <label
            for="workspace-settings-target"
            class="text-sm font-medium text-zinc-500 dark:text-zinc-400"
          >
            {t("selectSpace")}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCreateSpace(true)}
            disabled={settingsBusy()}
          >
            <Icons.Plus class="w-4 h-4 mr-1" />
            {t("createCategory")}
          </Button>
        </div>
        <select
          id="workspace-settings-target"
          name="workspace-settings-target"
          class="w-full max-w-md px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          value={selectedSpaceId() ?? ""}
          onChange={(e) => props.setSelectedSpaceId(e.currentTarget.value)}
          disabled={settingsBusy()}
        >
          <option value="" disabled>
            {t("selectSpace")}
          </option>
          <Show when={personalSpace()}>
            {(ps) => (
              <option value="me">
                {t("personal")} ({ps().name})
              </option>
            )}
          </Show>
          {otherSpaces().map((ws) => (
            <option value={ws.slug ?? ""}>{ws.name}</option>
          ))}
        </select>

        {showCreateSpace() && (
          <CreateSpaceModal
            onClose={() => setShowCreateSpace(false)}
            onCreate={handleCreateSpace}
          />
        )}
      </div>

      <Show
        when={selectedSpace()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
            {t("selectSpaceHint")}
          </div>
        }
      >
        {(space) => (
          <div class="flex-1 overflow-y-auto p-6 space-y-6">
            <SpaceInfoCard
              selectedSpace={space()}
              spaceName={spaceName()}
              setSpaceName={setSpaceName}
              spaceDescription={spaceDescription()}
              setSpaceDescription={setSpaceDescription}
              isPersonal={isPersonal()}
              canEdit={ownsSelectedSpace()}
              busy={settingsBusy()}
              saving={
                saveOperation()?.spaceId === space().id &&
                saveOperation()?.kind === "details"
              }
              onSave={handleSaveSpace}
            />

            <SecurityPostureCard
              securityPosture={securityPosture()}
              savedSecurityPosture={space().security_posture}
              setSecurityPosture={setSecurityPosture}
              canEdit={ownsSelectedSpace()}
              busy={settingsBusy()}
              saving={
                saveOperation()?.spaceId === space().id &&
                saveOperation()?.kind === "security"
              }
              onSave={handleSaveSecurityPosture}
            />

            {!isPersonal() && ownsSelectedSpace() && (
              <DangerZoneCard
                onDelete={handleDeleteSpace}
                deleting={deletingSpaceId() === selectedSpace()?.id}
                disabled={settingsBusy()}
              />
            )}

            {isPersonal() && <PersonalSpaceNote />}
          </div>
        )}
      </Show>
    </div>
  );
}
