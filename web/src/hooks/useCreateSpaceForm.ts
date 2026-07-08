import { createSignal } from "solid-js";
import { getErrorMessage } from "@takos/worker-platform-utils/errors";

interface UseCreateSpaceFormOptions {
  onCreate: (
    name: string,
    description: string,
    installFeaturedApps: boolean,
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
  const [installFeaturedApps, setInstallFeaturedApps] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const clearError = () => setError(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstallFeaturedApps(false);
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
      await onCreate(name(), description(), installFeaturedApps());
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
    installFeaturedApps,
    setInstallFeaturedApps,
    loading,
    error,
    clearError,
    resetForm,
    handleSubmit,
  };
}
