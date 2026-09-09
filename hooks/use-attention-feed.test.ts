import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mutateMock = vi.fn();
const swrSubscribeMock = vi.fn((..._args: unknown[]) => ({
  data: undefined,
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrSubscribeMock(...args),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

import { useAttentionFeed, useClearAttentionFeed } from "./use-attention-feed";

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("useClearAttentionFeed", () => {
  it("clears the exact key the feed subscribes with: undefined data, then a refetch", () => {
    renderHook(() => useAttentionFeed());
    const subscribedKey = swrSubscribeMock.mock.calls[0][0] as string;
    expect(subscribedKey).toBe("/api/dashboard/attention-feed");

    const { result } = renderHook(() => useClearAttentionFeed());
    void result.current();

    // Cleared, not revalidated: the feed renders "All clients on track" and
    // per-client claims, and the dashboard is not mounted while a plan writer
    // on a client page changes what it says.
    expect(mutateMock).toHaveBeenCalledWith(subscribedKey, undefined, { revalidate: true });
  });

  it("the feed reads with the config every coach-side read carries", () => {
    renderHook(() => useAttentionFeed());
    const options = swrSubscribeMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options).toMatchObject({
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
    });
  });
});
