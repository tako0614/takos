import { z } from "zod";

export const THREAD_SEARCH_QUERY_MAX_LENGTH = 500;

export const threadSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(THREAD_SEARCH_QUERY_MAX_LENGTH),
  type: z.enum(["all", "keyword", "semantic"]).default("all"),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

