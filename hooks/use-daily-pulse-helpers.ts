import { RATE_LIMIT_RETRY_DELAY_MS } from "@/lib/constants";

/**
 * Helper functions for use-daily-pulse hook.
 * Extracted to reduce hook file size.
 */

// Helper function to fetch with retry on 429 errors
export const fetchWithRetry = async (url: string, options: RequestInit, retryCount = 0): Promise<Response> => {
  const response = await fetch(url, options);
  
  if (response.status === 429 && retryCount === 0) {
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
    return fetchWithRetry(url, options, 1); // Retry once
  }
  
  return response;
};

// Helper function to fetch weekly logs with retry
export const fetchWeeklyLogs = async (dateString: string): Promise<Array<{ date: string; id: string }>> => {
  try {
    const response = await fetchWithRetry(`/api/client/daily-logs/week?date=${dateString}`, {
      cache: 'no-store'
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.data || [];
    }
    return [];
  } catch (_error) {
    // Silently fail for weekly logs - non-critical
    return [];
  }
};