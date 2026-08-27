import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { getSpaceIdentifier } from "../../lib/spaces.ts";
import type { Space } from "../../types/index.ts";
import {
  MAX_WORKSPACE_DESCRIPTION_CHARACTERS,
  MAX_WORKSPACE_NAME_CHARACTERS,
} from "takos-api-contract/shared/types";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card.tsx";

export function SpaceInfoCard(props: {
  selectedSpace: Space;
  spaceName: string;
  setSpaceName: (name: string) => void;
  spaceDescription: string;
  setSpaceDescription: (description: string) => void;
  isPersonal: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t, tOr } = useI18n();
  const { showToast } = useToast();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spaceInfo")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t("spaceName")}
            </label>
            <Input
              value={props.spaceName}
              onInput={(e) => props.setSpaceName(e.currentTarget.value)}
              placeholder={t("spaceNamePlaceholder")}
              disabled={props.isPersonal}
              maxLength={MAX_WORKSPACE_NAME_CHARACTERS}
            />
            {props.isPersonal && (
              <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t("personalSpaceNameHint")}
              </p>
            )}
          </div>
          <div>
            <label
              for="workspace-description"
              class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              {t("description")}
            </label>
            <textarea
              id="workspace-description"
              class="w-full min-h-24 resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-100/10 disabled:cursor-not-allowed disabled:opacity-60"
              value={props.spaceDescription}
              onInput={(event) =>
                props.setSpaceDescription(event.currentTarget.value)}
              maxLength={MAX_WORKSPACE_DESCRIPTION_CHARACTERS}
              disabled={props.isPersonal}
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {tOr("spaceSlug", t("workspaceSlug"))}
            </label>
            <div class="flex items-center gap-2">
              <code class="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 font-mono truncate">
                {getSpaceIdentifier(props.selectedSpace)}
              </code>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("copy")}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      getSpaceIdentifier(props.selectedSpace),
                    );
                    showToast("success", t("copied"));
                  } catch {
                    // Clipboard can be denied (permissions / insecure context);
                    // don't claim success when nothing was copied.
                    showToast("error", t("copyFailed"));
                  }
                }}
              >
                <Icons.Copy class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      {!props.isPersonal && (
        <CardFooter>
          <Button
            variant="primary"
            size="sm"
            onClick={props.onSave}
            isLoading={props.saving}
            disabled={!props.spaceName.trim() ||
              (props.spaceName === props.selectedSpace.name &&
                props.spaceDescription ===
                  (props.selectedSpace.description ?? ""))}
          >
            {t("save")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function DangerZoneCard(props: {
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle class="text-red-600 dark:text-red-400">
          {t("dangerZone")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div>
            <h4 class="font-medium text-zinc-900 dark:text-zinc-100">
              {t("deleteSpace")}
            </h4>
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {t("deleteSpaceHint")}
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={props.onDelete}
          >
            {t("delete")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonalSpaceNote() {
  const { t } = useI18n();

  return (
    <Card>
      <CardContent>
        <div class="flex items-start gap-3 text-zinc-500 dark:text-zinc-400">
          <Icons.Info class="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p class="text-sm">
            {t("personalSpaceNote")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
