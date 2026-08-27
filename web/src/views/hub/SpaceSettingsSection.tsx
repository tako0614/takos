import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { getErrorMessage } from "../../lib/errors.ts";
import { findSpaceByIdentifier, splitSpaces } from "../../lib/spaces.ts";
import type { Space } from "../../types/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import { CreateSpaceModal } from "../shared/spaces/CreateSpaceModal.tsx";
import {
  DangerZoneCard,
  PersonalSpaceNote,
  SpaceInfoCard,
} from "./SpaceSettingsCards.tsx";

interface SpaceSettingsSectionProps {
  spaces: Space[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string | null) => void;
  onSpaceDeleted?: () => void;
  onSpaceUpdated?: () => void;
}

export function SpaceSettingsSection(props: SpaceSettingsSectionProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const selectedSpaceId = () => props.selectedSpaceId;

  const [spaceName, setSpaceName] = createSignal("");
  const [spaceDescription, setSpaceDescription] = createSignal("");
  const [isPersonal, setIsPersonal] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const [showCreateSpace, setShowCreateSpace] = createSignal(false);

  const groupedSpaces = createMemo(() => splitSpaces(props.spaces || []));
  const personalSpace = createMemo(() => groupedSpaces().personalSpace);
  const otherSpaces = createMemo(() => groupedSpaces().otherSpaces);
  const selectedSpace = createMemo(() => {
    const id = selectedSpaceId();
    return id
      ? findSpaceByIdentifier(props.spaces || [], id)
      : null;
  });

  createEffect(() => {
    const space = selectedSpace();
    if (space) {
      setSpaceName(space.name);
      setSpaceDescription(space.description ?? "");
      setIsPersonal(space.is_default);
    } else {
      setSpaceName("");
      setSpaceDescription("");
      setIsPersonal(false);
    }
  });

  const handleSaveSpace = async () => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId || !spaceName().trim()) return;
    try {
      setSaving(true);
      const res = await rpc.spaces[":spaceId"].$patch({
        param: { spaceId: targetSpaceId },
        json: {
          name: spaceName().trim(),
          description: spaceDescription().trim() || null,
        },
      });
      await rpcJson(res);
      showToast("success", t("saved"));
      props.onSpaceUpdated?.();
    } catch {
      showToast("error", t("failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSpace = async () => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId || isPersonal()) return;
    const confirmed = await confirm({
      title: t("deleteSpace"),
      message: t("deleteSpaceWarning"),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[":spaceId"].$delete({
        param: { spaceId: targetSpaceId },
      });
      await rpcJson(res);
      showToast("success", t("spaceDeleted"));
      props.onSpaceDeleted?.();
    } catch (err: unknown) {
      showToast("error", getErrorMessage(err, t("failedToDelete")));
    }
  };

  const handleCreateSpace = async (
    name: string,
    description: string,
    installFeaturedApps: boolean,
  ) => {
    if (!name) return;
    try {
      const res = await rpc.spaces.$post({
        json: {
          name,
          description: description.trim() || undefined,
          installFeaturedApps,
        },
      });
      const data = await rpcJson<{ space: { slug: string } }>(res);
      showToast("success", t("spaceCreated"));
      setShowCreateSpace(false);
      props.onSpaceUpdated?.();
      props.setSelectedSpaceId(data.space.slug);
    } catch (err: unknown) {
      throw new Error(getErrorMessage(err, t("failedToCreate")));
    }
  };

  return (
    <div class="h-full flex flex-col bg-zinc-50/30 dark:bg-zinc-900/30">
      <div class="flex items-center gap-3 px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          <Icons.Settings class="w-4 h-4" />
        </div>
        <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t("spaceSettings")}
        </h3>
      </div>

      <div class="px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("selectSpace")}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCreateSpace(true)}
          >
            <Icons.Plus class="w-4 h-4 mr-1" />
            {t("createSpace")}
          </Button>
        </div>
        <select
          class="w-full max-w-md px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          value={selectedSpaceId() ?? ""}
          onChange={(e) => props.setSelectedSpaceId(e.currentTarget.value)}
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
              saving={saving()}
              onSave={handleSaveSpace}
            />

            {!isPersonal() && <DangerZoneCard onDelete={handleDeleteSpace} />}

            {isPersonal() && <PersonalSpaceNote />}
          </div>
        )}
      </Show>
    </div>
  );
}
