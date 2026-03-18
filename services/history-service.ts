import type { Database } from "@/types/database";
import { supabaseAdmin } from "./supabase-admin";

type TableName = keyof Database["public"]["Tables"];

type PaginatedHistoryOptions = {
  limit: number;
  offset: number;
  dateColumn?: string;
};

/**
 * Generic paginated query helper for history tables.
 * Uses supabaseAdmin because coach-side history views query across
 * client data that RLS would block (exception 3).
 */
export async function getPaginatedHistory<T = Record<string, unknown>>(
  table: TableName,
  clientId: string,
  options: PaginatedHistoryOptions
): Promise<{ rows: T[]; total: number }> {
  const { limit, offset, dateColumn = "date" } = options;

  const { data, error, count } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact" })
    .eq("client_id", clientId)
    .order(dateColumn, { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch history from ${table}: ${error.message}`);
  }

  return {
    rows: (data || []) as T[],
    total: count || 0,
  };
}
