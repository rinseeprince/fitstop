/**
 * Shared paged reader for PostgREST queries that must return a COMPLETE set.
 *
 * PostgREST caps an unpaged response at ~1000 rows and reports no error when it
 * truncates — the caller just silently receives a prefix. That is fine for a
 * bounded lookup and corrupting for anything that feeds an aggregate, a count,
 * or a whole-program read. The repo already carried this loop copy-pasted at
 * four sites (exercise-catalog-service.ts:96 and :313,
 * coach-saved-plan-service.ts:602 and :749); this is the same shape, factored
 * out so a fifth caller cannot get it subtly wrong.
 *
 * CALLER CONTRACT: `buildPage` MUST apply a deterministic `.order()` — offset
 * paging over an unordered query can repeat or skip rows between pages, which
 * turns one silent-truncation bug into a different silent-correctness bug. Add a
 * unique tiebreak (usually `id`) when the sort column is not unique.
 *
 * NOTE — this does not fix `.in()` URL length. A filter inlining thousands of
 * UUIDs can exceed the gateway request-line limit regardless of paging; that
 * needs a server-side aggregate instead (tracked separately).
 */

const DEFAULT_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; errorLabel?: string } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const label = options.errorLabel ?? "paged query";
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch ${label}: ${error.message}`);

    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

/**
 * Split ids into chunks small enough that an `.in()` filter stays under the
 * PostgREST request-line ceiling (~37 bytes per inlined UUID).
 */
export function chunkIds<T>(ids: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/**
 * Complete read of rows matching an `.in(<column>, ids)` filter, safe against
 * BOTH ceilings at once.
 *
 * A long id list has two independent failure modes and fixing one leaves the
 * other: paging alone still blows the request-line limit once the inlined ids
 * exceed it, and chunking alone still truncates at ~1000 rows within a chunk.
 * This chunks the ids AND pages within each chunk.
 *
 * Same caller contract as fetchAllPages: `buildPage` MUST apply a deterministic
 * `.order()`, including a unique tiebreak.
 */
export async function fetchAllByChunkedIds<T, Id>(
  ids: Id[],
  buildPage: (chunk: Id[], from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { chunkSize?: number; pageSize?: number; errorLabel?: string } = {},
): Promise<T[]> {
  if (ids.length === 0) return [];

  const rows: T[] = [];
  for (const chunk of chunkIds(ids, options.chunkSize ?? 100)) {
    const page = await fetchAllPages<T>(
      (from, to) => buildPage(chunk, from, to),
      { pageSize: options.pageSize, errorLabel: options.errorLabel },
    );
    rows.push(...page);
  }
  return rows;
}
