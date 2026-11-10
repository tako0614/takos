import { createSignal, onCleanup } from "solid-js";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";

interface UseFileUploadParams {
  uploadFile: (file: File) => Promise<unknown>;
  getScope: () => symbol | undefined;
}

interface UseFileUploadResult {
  uploading: () => boolean;
  handleFileSelect: (files: FileList | null) => Promise<void>;
}

export function useFileUpload(
  { uploadFile, getScope }: UseFileUploadParams,
): UseFileUploadResult {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [uploading, setUploading] = createSignal(false);
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const handleFileSelect = async (fileList: FileList | null) => {
    if (disposed || uploading() || !fileList || fileList.length === 0) return;
    const scope = getScope();
    if (!scope) return;
    const files = Array.from(fileList);
    const isCurrent = () => !disposed && getScope() === scope;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const file of files) {
        if (!isCurrent()) return;
        try {
          const result = await uploadFile(file);
          if (!isCurrent()) return;
          if (result) successCount++;
          else failCount++;
        } catch {
          if (!isCurrent()) return;
          failCount++;
          break;
        }
      }
    } finally {
      setUploading(false);
    }

    if (!isCurrent()) return;

    if (successCount > 0) {
      showToast(
        "success",
        t("filesUploaded").replace("{count}", String(successCount)),
      );
    }
    if (failCount > 0) {
      showToast(
        "error",
        t("filesFailedToUpload").replace("{count}", String(failCount)),
      );
    }
  };

  return { uploading, handleFileSelect };
}
