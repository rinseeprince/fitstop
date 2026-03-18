/**
 * Shared SWR fetcher that throws on non-OK responses.
 * When the fetcher throws, SWR preserves previously cached data
 * and sets the `error` field — giving us stale-while-revalidate on failures.
 */
export const swrFetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error("API request failed") as Error & {
      status: number;
      info?: unknown;
    };
    error.status = response.status;
    try {
      error.info = await response.json();
    // eslint-disable-next-line no-empty
    } catch {}
    throw error;
  }
  return response.json();
};
