import { createSignal } from "solid-js";
import { getErrorMessage } from "takos-common/errors";

interface UseCreateSpaceFormOptions {
  onCreate: (
    name: string,
    description: string,
    installDefaultApps: boolean,
  ) => Promise<void>;
  nameRequiredMessage: string;
  failedToCreateMessage: string;
}

export function useCreateSpaceForm({
  onCreate,
  nameRequiredMessage,
  failedToCreateMessage,
}: UseCreateSpaceFormOptions) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [installDefaultApps, setInstallDefaultApps] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const clearError = () => setError(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstallDefaultApps(true);
    setLoading(false);
    setError(null);
  };

  const handleSubmit = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    if (!name().trim()) {
      setError(nameRequiredMessage);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onCreate(name(), description(), installDefaultApps());
    } catch (err: unknown) {
      setError(getErrorMessage(err, failedToCreateMessage));
    } finally {
      setLoading(false);
    }
  };

  return {
    name,
    setName,
    description,
    setDescription,
    installDefaultApps,
    setInstallDefaultApps,
    loading,
    error,
    clearError,
    resetForm,
    handleSubmit,
  };
}
