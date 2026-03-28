import { useState, useCallback } from 'react';
import { getErrorMessage } from 'takos-common/errors';

interface UseFileContentReturn {
  content: string | null;
  encoding: 'utf-8' | 'base64' | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  loadContent: (fileId: string) => Promise<void>;
  saveContent: (fileId: string, content: string) => Promise<boolean>;
}

export function useFileContent(spaceId: string): UseFileContentReturn {
  const [content, setContent] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<'utf-8' | 'base64' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadContent = useCallback(async (fileId: string) => {
    setLoading(true);
    setError(null);
    setContent(null);
    setEncoding(null);

    try {
      const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/storage/${encodeURIComponent(fileId)}/content`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to load file content');
      }
      const data = await res.json() as { content: string; encoding: 'utf-8' | 'base64' };
      setContent(data.content);
      setEncoding(data.encoding);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load file content'));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  const saveContent = useCallback(async (fileId: string, newContent: string): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/storage/${encodeURIComponent(fileId)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to save file');
      }
      setContent(newContent);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save file'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [spaceId]);

  return { content, encoding, loading, error, saving, loadContent, saveContent };
}
