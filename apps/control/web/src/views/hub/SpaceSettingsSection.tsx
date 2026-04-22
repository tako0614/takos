import { createEffect, createMemo, createSignal } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { getErrorMessage } from "../../lib/errors.ts";
import { findSpaceByIdentifier, splitSpaces } from "../../lib/spaces.ts";
import type { Space } from "../../types/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import {
  CreateSpaceModal,
  DangerZoneCard,
  MembersCard,
  PersonalSpaceNote,
  SpaceInfoCard,
  type SpaceMember,
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
  const [isPersonal, setIsPersonal] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const [members, setMembers] = createSignal<SpaceMember[]>([]);
  const [loadingMembers, setLoadingMembers] = createSignal(false);

  const [inviteEmail, setInviteEmail] = createSignal("");
  const [inviteRole, setInviteRole] = createSignal<"admin" | "member">(
    "member",
  );
  const [inviting, setInviting] = createSignal(false);

  const [showCreateSpace, setShowCreateSpace] = createSignal(false);
  const [creatingSpace, setCreatingSpace] = createSignal(false);

  const groupedSpaces = createMemo(() =>
    splitSpaces(props.spaces || [], t("personal"))
  );
  const personalSpace = createMemo(() => groupedSpaces().personalSpace);
  const otherSpaces = createMemo(() => groupedSpaces().otherSpaces);
  const selectedSpace = createMemo(() =>
    selectedSpaceId()
      ? findSpaceByIdentifier(
        props.spaces || [],
        selectedSpaceId()!,
        t("personal"),
      )
      : null
  );

  createEffect(() => {
    const space = selectedSpace();
    if (space) {
      setSpaceName(space.name as string);
      setIsPersonal(space.is_personal as boolean);
    } else {
      setSpaceName("");
      setIsPersonal(false);
    }
  });

  const fetchMembers = async () => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId) return;
    try {
      setLoadingMembers(true);
      const res = await rpc.spaces[":spaceId"].members.$get({
        param: { spaceId: targetSpaceId },
      });
      const data = await rpcJson<{ members: SpaceMember[] }>(res);
      if (targetSpaceId !== selectedSpaceId()) return;
      setMembers(data.members || []);
    } catch {
      // member fetch failed silently
    } finally {
      setLoadingMembers(false);
    }
  };

  createEffect(() => {
    if (selectedSpaceId() && !selectedSpace()?.is_personal) {
      void fetchMembers();
    } else {
      setMembers([]);
    }
  });

  const handleSaveSpace = async () => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId || !spaceName().trim()) return;
    try {
      setSaving(true);
      const res = await rpc.spaces[":spaceId"].$patch({
        param: { spaceId: targetSpaceId },
        json: { name: spaceName().trim() },
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

  const handleInviteMember = async () => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId || !inviteEmail().trim()) return;
    try {
      setInviting(true);
      const res = await rpc.spaces[":spaceId"].members.$post({
        param: { spaceId: targetSpaceId },
        json: { email: inviteEmail().trim(), role: inviteRole() },
      });
      await rpcJson(res);
      showToast("success", t("memberInvited"));
      setInviteEmail("");
      fetchMembers();
    } catch (err: unknown) {
      showToast(
        "error",
        getErrorMessage(err, t("failedToInvite")),
      );
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (member: SpaceMember) => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId) return;
    const confirmed = await confirm({
      title: t("removeMember"),
      message: t("removeMemberWarning"),
      confirmText: t("remove"),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[":spaceId"].members[":username"].$delete({
        param: { spaceId: targetSpaceId, username: member.username },
      });
      await rpcJson(res);
      showToast("success", t("memberRemoved"));
      fetchMembers();
    } catch (err: unknown) {
      showToast(
        "error",
        getErrorMessage(err, t("failedToRemove")),
      );
    }
  };

  const handleChangeMemberRole = async (
    member: SpaceMember,
    newRole: "admin" | "member",
  ) => {
    const targetSpaceId = selectedSpaceId();
    if (!targetSpaceId || member.role === newRole) return;
    try {
      const res = await rpc.spaces[":spaceId"].members[":username"].$patch({
        param: { spaceId: targetSpaceId, username: member.username },
        json: { role: newRole },
      });
      await rpcJson(res);
      showToast("success", t("memberUpdated"));
      fetchMembers();
    } catch (err: unknown) {
      showToast(
        "error",
        getErrorMessage(err, t("failedToUpdate")),
      );
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
    installDefaultApps: boolean,
  ) => {
    if (!name) return;
    try {
      setCreatingSpace(true);
      const res = await rpc.spaces.$post({
        json: { name, installDefaultApps },
      });
      const data = await rpcJson<{ space: { slug: string } }>(res);
      showToast("success", t("spaceCreated"));
      setShowCreateSpace(false);
      props.onSpaceUpdated?.();
      props.setSelectedSpaceId(data.space.slug);
    } catch (err: unknown) {
      showToast("error", getErrorMessage(err, t("failedToCreate")));
    } finally {
      setCreatingSpace(false);
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
          {personalSpace() && (
            <option value="me">
              {t("personal")} ({personalSpace()!.name})
            </option>
          )}
          {otherSpaces().map((ws) => (
            <option value={ws.slug ?? ""}>{ws.name}</option>
          ))}
        </select>

        {showCreateSpace() && (
          <CreateSpaceModal
            onClose={() => setShowCreateSpace(false)}
            onCreate={handleCreateSpace}
            creating={creatingSpace()}
          />
        )}
      </div>

      {selectedSpace()
        ? (
          <div class="flex-1 overflow-y-auto p-6 space-y-6">
            <SpaceInfoCard
              selectedSpace={selectedSpace()!}
              spaceName={spaceName()}
              setSpaceName={setSpaceName}
              isPersonal={isPersonal()}
              saving={saving()}
              onSave={handleSaveSpace}
            />

            {!isPersonal() && (
              <MembersCard
                members={members()}
                loadingMembers={loadingMembers()}
                inviteEmail={inviteEmail()}
                setInviteEmail={setInviteEmail}
                inviteRole={inviteRole()}
                setInviteRole={setInviteRole}
                inviting={inviting()}
                onInvite={handleInviteMember}
                onRemove={handleRemoveMember}
                onChangeRole={handleChangeMemberRole}
              />
            )}

            {!isPersonal() && <DangerZoneCard onDelete={handleDeleteSpace} />}

            {isPersonal() && <PersonalSpaceNote />}
          </div>
        )
        : (
          <div class="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
            {t("selectSpaceHint")}
          </div>
        )}
    </div>
  );
}
