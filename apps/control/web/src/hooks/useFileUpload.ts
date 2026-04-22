import { createSignal } from "solid-js";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";

interface UseFileUploadParams {
  uploadFile: (file: File) => Promise<unknown>;
}

interface UseFileUploadResult {
  uploading: () => boolean;
  handleFileSelect: (files: FileList | null) => void;
}

export function useFileUpload(
  { uploadFile }: UseFileUploadParams,
): UseFileUploadResult {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [uploading, setUploading] = createSignal(false);

  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const result = await uploadFile(file);
      if (result) {
        successCount++;
      } else {
        failCount++;
      }
    }

    setUploading(false);

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
