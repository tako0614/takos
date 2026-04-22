import { type Accessor, createSignal } from "solid-js";
import { getErrorMessage } from "takos-common/errors";
import { useI18n } from "../store/i18n.ts";

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
  spaceId: Accessor<string>,
): UseFileContentReturn {
  const { t } = useI18n();
  const [content, setContent] = createSignal<string | null>(null);
  const [encoding, setEncoding] = createSignal<"utf-8" | "base64" | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const loadContent = async (fileId: string) => {
    const currentSpaceId = spaceId();
    setLoading(true);
    setError(null);
    setContent(null);
    setEncoding(null);

    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(currentSpaceId)}/storage/${
          encodeURIComponent(fileId)
        }/content`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || t("failedToLoadFileContent"));
      }
      const data = await res.json() as {
        content: string;
        encoding: "utf-8" | "base64";
      };
      setContent(data.content);
      setEncoding(data.encoding);
    } catch (err) {
      setError(getErrorMessage(err, t("failedToLoadFileContent")));
    } finally {
      setLoading(false);
    }
  };

  const saveContent = async (
    fileId: string,
    newContent: string,
  ): Promise<boolean> => {
    const currentSpaceId = spaceId();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(currentSpaceId)}/storage/${
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
