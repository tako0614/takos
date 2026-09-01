export interface WelcomeSubmissionOptions {
  message: string;
  files: File[];
  createThread?: (message: string, files?: File[]) => Promise<boolean>;
  onNewChat?: (message?: string) => void;
}

export async function submitWelcomeDraft({
  message,
  files,
  createThread,
  onNewChat,
}: WelcomeSubmissionOptions): Promise<boolean> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage && files.length === 0) return false;

  if (createThread) {
    return await createThread(
      trimmedMessage,
      files.length > 0 ? files : undefined,
    );
  }

  if (!onNewChat) return false;
  onNewChat(trimmedMessage);
  return true;
}
