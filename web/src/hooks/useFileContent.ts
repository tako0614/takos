import { type Accessor, createSignal } from "solid-js";
import { getErrorMessage } from "../lib/errors.ts";
import { useI18n } from "../store/i18n.ts";
import {
  parseStorageContentResponse,
  parseStorageFileMutationResponse,
} from "./storage-response.ts";

interface UseFileContentReturn {
  content: () => string | null;
  encoding: () => "utf-8" | "base64" | null;
  loading: () => boolean;
  error: () => string | null;
  saving: () => boolean;
  loadContent: (fileId: string) => Promise<void>;
  saveContent: (fileId: string, content: string) => Promise<boolean>;
}

export function useFileContent(
  spaceIdentifier: Accessor<string>,
  spaceRecordId: Accessor<string>,
): UseFileContentReturn {
  const { t } = useI18n();
  const [content, setContent] = createSignal<string | null>(null);
  const [encoding, setEncoding] = createSignal<"utf-8" | "base64" | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  let loadVersion = 0;

  const loadContent = async (fileId: string) => {
    const currentSpaceIdentifier = spaceIdentifier();
    const currentSpaceRecordId = spaceRecordId();
    const version = ++loadVersion;
    setLoading(true);
    setError(null);
    setContent(null);
    setEncoding(null);

    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(currentSpaceIdentifier)}/storage/${
          encodeURIComponent(fileId)
        }/content`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || t("failedToLoadFileContent"));
      }
      const data = parseStorageContentResponse(await res.json(), {
        spaceId: currentSpaceRecordId,
        fileId,
      });
      if (
        version !== loadVersion ||
        spaceIdentifier() !== currentSpaceIdentifier ||
        spaceRecordId() !== currentSpaceRecordId
      ) return;
      setContent(data.content);
      setEncoding(data.encoding);
    } catch (err) {
      if (version !== loadVersion) return;
      setError(getErrorMessage(err, t("failedToLoadFileContent")));
    } finally {
      if (version === loadVersion) setLoading(false);
    }
  };

  const saveContent = async (
    fileId: string,
    newContent: string,
  ): Promise<boolean> => {
    if (saving()) return false;
    const currentSpaceIdentifier = spaceIdentifier();
    const currentSpaceRecordId = spaceRecordId();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(currentSpaceIdentifier)}/storage/${
          encodeURIComponent(fileId)
        }/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || t("failedToSaveFile"));
      }
      parseStorageFileMutationResponse(await res.json(), {
        spaceId: currentSpaceRecordId,
        id: fileId,
      });
      if (
        spaceIdentifier() !== currentSpaceIdentifier ||
        spaceRecordId() !== currentSpaceRecordId
      ) return false;
      setContent(newContent);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, t("failedToSaveFile")));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    content,
    encoding,
    loading,
    error,
    saving,
    loadContent,
    saveContent,
  };
}
