import { useState, type FormEvent } from 'react';
import { getErrorMessage } from '../lib/errors';

interface UseCreateWorkspaceFormOptions {
  onCreate: (name: string, description: string) => Promise<void>;
  nameRequiredMessage: string;
  failedToCreateMessage: string;
}

export function useCreateWorkspaceForm({
  onCreate,
  nameRequiredMessage,
  failedToCreateMessage,
}: UseCreateWorkspaceFormOptions) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const resetForm = () => {
    setName('');
    setDescription('');
    setLoading(false);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(nameRequiredMessage);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onCreate(name, description);
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
    loading,
    error,
    clearError,
    resetForm,
    handleSubmit,
  };
}
