import { createSignal } from "solid-js";
import { getErrorMessage } from "../lib/errors.ts";
import { createClientOperationId } from "../lib/client-operation-id.ts";

interface UseCreateSpaceFormOptions {
  onCreate: (
    name: string,
    description: string,
    installFeaturedApps: boolean,
    operationId: string,
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
  let pendingOperation: {
    draft: string;
    id: string;
  } | null = null;

  const clearError = () => setError(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstallFeaturedApps(false);
    setLoading(false);
    setError(null);
    pendingOperation = null;
  };

  const submit = async () => {
    if (loading()) return;
    if (!name().trim()) {
      setError(nameRequiredMessage);
      return;
    }

    setLoading(true);
    setError(null);
    const normalizedName = name().trim();
    const normalizedDescription = description().trim();
    const draft = JSON.stringify([
      normalizedName,
      normalizedDescription,
      installFeaturedApps(),
    ]);
    if (!pendingOperation || pendingOperation.draft !== draft) {
      pendingOperation = { draft, id: createClientOperationId() };
    }
    try {
      await onCreate(
        normalizedName,
        normalizedDescription,
        installFeaturedApps(),
        pendingOperation.id,
      );
      pendingOperation = null;
    } catch (err: unknown) {
      setError(getErrorMessage(err, failedToCreateMessage));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    await submit();
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
    submit,
    handleSubmit,
  };
}
