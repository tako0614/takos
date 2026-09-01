export const THREAD_SHARE_TOKEN_CHARACTERS = 32;
export const THREAD_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/u;

export const MIN_THREAD_SHARE_PASSWORD_CHARACTERS = 8;
export const MAX_THREAD_SHARE_PASSWORD_CHARACTERS = 256;
export const MAX_THREAD_SHARE_PASSWORD_BYTES = 1_024;

export const DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE = 50;
export const MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE = 100;
export const MAX_PUBLIC_THREAD_SHARE_PAGE_OFFSET = 1_000_000;
export const MAX_PUBLIC_THREAD_SHARE_MESSAGE_CONTENT_BYTES = 512 * 1_024;
export const MAX_PUBLIC_THREAD_SHARE_PAGE_CONTENT_BYTES = 8 * 1_024 * 1_024;

export type PublicThreadShareMode = "public" | "password";

export interface PublicThreadShareMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  content_truncated: boolean;
  sequence: number;
  created_at: string;
}

export interface PublicThreadSharePage {
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  message_data_truncated: boolean;
}
