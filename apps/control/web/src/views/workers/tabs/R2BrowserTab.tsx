import { createEffect, createSignal, For } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { useToast } from "../../../store/toast.ts";
import { useConfirmDialog } from "../../../store/confirm-dialog.ts";
import { Icons } from "../../../lib/Icons.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { rpc, rpcJson, rpcPath } from "../../../lib/rpc.ts";
import type { Resource } from "../../../types/index.ts";
import { formatDateTime, formatFileSize } from "../../../lib/format.ts";

interface R2Object {
  key: string;
  size: number;
  uploaded: string;
  etag?: string;
}

interface R2ObjectPayload {
  key: string;
  value: string;
  content_type?: string | null;
  size: number;
}

interface R2BrowserTabProps {
  resource: Resource;
}

function getFileIcon(key: string): JSX.Element {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "ico"];
  const codeExts = ["js", "ts", "tsx", "jsx", "html", "css", "json", "md"];
  const archiveExts = ["zip", "tar", "gz", "rar", "7z"];

  if (imageExts.includes(ext)) {
    return <Icons.File class="w-5 h-5 text-purple-500" />;
  }
  if (codeExts.includes(ext)) {
    return <Icons.Code class="w-5 h-5 text-blue-500" />;
  }
  if (archiveExts.includes(ext)) {
    return <Icons.Archive class="w-5 h-5 text-orange-500" />;
  }
  return <Icons.File class="w-5 h-5 text-zinc-500 dark:text-zinc-400" />;
}

function getDisplayName(key: string, prefix: string): string {
  const withoutPrefix = prefix ? key.slice(prefix.length) : key;
  return withoutPrefix || key;
}

function getFolders(objects: R2Object[], prefix: string): string[] {
  const folders = new Set<string>();
  for (const obj of objects) {
    const keyWithoutPrefix = prefix ? obj.key.slice(prefix.length) : obj.key;
    const slashIndex = keyWithoutPrefix.indexOf("/");
    if (slashIndex > 0) {
      folders.add(keyWithoutPrefix.slice(0, slashIndex + 1));
    }
  }
  return Array.from(folders).sort();
}

function getFiles(objects: R2Object[], prefix: string): R2Object[] {
  return objects.filter((obj) => {
    const keyWithoutPrefix = prefix ? obj.key.slice(prefix.length) : obj.key;
    return !keyWithoutPrefix.includes("/");
  });
}

export function R2BrowserTab({ resource }: R2BrowserTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [objects, setObjects] = createSignal<R2Object[]>([]);
  const [prefix, setPrefix] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [deletingKey, setDeletingKey] = createSignal<string | null>(null);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [cursor, setCursor] = createSignal<string | undefined>(undefined);
  const [hasMore, setHasMore] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;

  const fetchObjects = async (
    newPrefix: string = prefix(),
    reset: boolean = true,
  ) => {
    setLoading(true);
    try {
      const res = await rpc.resources[":id"].r2.objects.$get({
        param: { id: resource.id },
        query: {
          prefix: newPrefix || undefined,
          cursor: reset ? undefined : cursor(),
          limit: "100",
        },
      });
      const result = await rpcJson<
        { objects: R2Object[]; truncated: boolean; cursor?: string }
      >(res);
      if (reset) setObjects(result.objects || []);
      else setObjects((prev) => [...prev, ...(result.objects || [])]);
      setHasMore(result.truncated);
      setCursor(result.cursor);
      setPrefix(newPrefix);
    } catch {
      showToast("error", t("failedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    fetchObjects("", true);
  });

  const navigateToFolder = (folderName: string) => {
    fetchObjects(prefix() + folderName, true);
  };

  const navigateUp = () => {
    if (!prefix()) return;
    const parts = prefix().slice(0, -1).split("/");
    parts.pop();
    fetchObjects(parts.length > 0 ? parts.join("/") + "/" : "", true);
  };

  const navigateToRoot = () => {
    fetchObjects("", true);
  };

  const uploadFile = async (file: File) => {
    const key = prefix() + file.name;
    try {
      const res = await rpcPath(rpc, "resources", ":id", "objects", ":key")
        .$put({
          param: { id: resource.id, key: encodeURIComponent(key) },
          json: {
            value: await file.text(),
            content_type: file.type || "application/octet-stream",
          },
        });
      await rpcJson(res);
      return true;
    } catch {
      return false;
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let success = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      if (await uploadFile(files[i])) success++;
      else fail++;
    }
    setUploading(false);
    if (success > 0) {
      showToast("success", t("uploadSuccess"));
      fetchObjects(prefix(), true);
    }
    if (fail > 0) showToast("error", t("uploadFailed"));
    if (fileInputRef) fileInputRef.value = "";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer?.files ?? null);
  };

  const handleDelete = async (key: string) => {
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("r2DeleteConfirm").replace("{key}", key),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;
    setDeletingKey(key);
    try {
      const res = await rpc.resources[":id"].r2.objects[":key"].$delete({
        param: { id: resource.id, key: encodeURIComponent(key) },
      });
      if (!res.ok) throw new Error("Delete failed");
      showToast("success", t("deleted"));
      fetchObjects(prefix(), true);
    } catch {
      showToast("error", t("failedToDelete"));
    } finally {
      setDeletingKey(null);
    }
  };

  const handleDownload = async (key: string) => {
    try {
      const res = await rpcPath(rpc, "resources", ":id", "objects", ":key")
        .$get({
          param: { id: resource.id, key: encodeURIComponent(key) },
        });
      const object = await rpcJson<R2ObjectPayload>(res);
      const blob = new Blob([object.value], {
        type: object.content_type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = key.split("/").pop() || key;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast("error", t("failedToLoad"));
    }
  };

  const breadcrumbParts = () =>
    prefix() ? prefix().slice(0, -1).split("/") : [];
  const folders = () => getFolders(objects(), prefix());
  const files = () => getFiles(objects(), prefix());

  return (
    <div
      class={"space-y-4 min-h-[400px] relative " +
        (isDragOver() ? "ring-2 ring-blue-500 ring-inset rounded-lg" : "")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver() && (
        <div class="absolute inset-0 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div class="flex flex-col items-center gap-2 text-blue-600 dark:text-blue-400">
            <Icons.Upload class="w-12 h-12" />
            <span class="text-lg font-medium">{t("dragDropHint")}</span>
          </div>
        </div>
      )}
      <div class="flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div class="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
          <button
            type="button"
            onClick={navigateToRoot}
            class="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex-shrink-0"
          >
            <Icons.Bucket class="w-4 h-4" />
            <span class="font-medium">{resource.name}</span>
          </button>
          <For each={breadcrumbParts()}>
            {(part, index) => (
              <>
                <Icons.ChevronRight class="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <button
                  type="button"
                  onClick={() =>
                    fetchObjects(
                      breadcrumbParts().slice(0, index() + 1).join("/") + "/",
                      true,
                    )}
                  class="text-sm text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                >
                  {part}
                </button>
              </>
            )}
          </For>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchObjects(prefix(), true)}
            disabled={loading()}
            leftIcon={
              <Icons.Refresh
                class={"w-4 h-4 " + (loading() ? "animate-spin" : "")}
              />
            }
          >
            {t("refresh")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            class="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef?.click()}
            disabled={uploading()}
            leftIcon={<Icons.Upload class="w-4 h-4" />}
            isLoading={uploading()}
          >
            {t("upload")}
          </Button>
        </div>
      </div>
      <div class="rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {loading() && objects().length === 0
          ? (
            <div class="flex items-center justify-center p-8">
              <Icons.Loader class="w-6 h-6 animate-spin text-zinc-500 dark:text-zinc-400" />
            </div>
          )
          : folders().length === 0 && files().length === 0
          ? (
            <div class="flex flex-col items-center justify-center p-12 text-zinc-500 dark:text-zinc-400">
              <Icons.Bucket class="w-12 h-12 mb-4 opacity-50" />
              <p class="text-sm">{t("noObjects")}</p>
              <p class="text-xs mt-2">{t("dragDropHint")}</p>
            </div>
          )
          : (
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-700">
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t("name")}
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-28">
                    {t("size")}
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-44">
                    {t("r2LastModified")}
                  </th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-28">
                    {t("actions")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-200 dark:divide-zinc-700">
                {prefix() && (
                  <tr
                    class="hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                    onClick={navigateUp}
                  >
                    <td class="px-4 py-3" colSpan={4}>
                      <div class="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
                        <Icons.FolderOpen class="w-5 h-5 text-amber-500" />
                        <span>..</span>
                      </div>
                    </td>
                  </tr>
                )}
                {folders().map((folder) => (
                  <tr
                    class="hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                    onClick={() => navigateToFolder(folder)}
                  >
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
                        <Icons.Folder class="w-5 h-5 text-amber-500" />
                        <span>{folder}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      -
                    </td>
                    <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      -
                    </td>
                    <td class="px-4 py-3 text-right">-</td>
                  </tr>
                ))}
                {files().map((obj) => {
                  const displayName = getDisplayName(obj.key, prefix());
                  return (
                    <tr class="hover:bg-zinc-100 dark:hover:bg-zinc-700">
                      <td class="px-4 py-3">
                        <div class="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
                          {getFileIcon(obj.key)}
                          <span class="truncate max-w-md" title={displayName}>
                            {displayName}
                          </span>
                        </div>
                      </td>
                      <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatFileSize(obj.size)}
                      </td>
                      <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatDateTime(obj.uploaded)}
                      </td>
                      <td class="px-4 py-3">
                        <div class="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleDownload(obj.key)}
                            class="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                            title={t("download")}
                          >
                            <Icons.Download class="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(obj.key);
                            }}
                            disabled={deletingKey() === obj.key}
                            class="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-zinc-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                            title={t("delete")}
                          >
                            {deletingKey() === obj.key
                              ? <Icons.Loader class="w-4 h-4 animate-spin" />
                              : <Icons.Trash class="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        {hasMore() && (
          <div class="p-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchObjects(prefix(), false)}
              disabled={loading()}
              isLoading={loading()}
              class="w-full"
            >
              {t("r2LoadMore")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
