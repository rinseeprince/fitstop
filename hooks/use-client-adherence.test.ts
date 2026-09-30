import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("swr", () => ({ __esModule: true, default: vi.fn(() => ({})), useSWRConfig: () => ({ mutate }) }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { clientAdherenceKey, useClearClientAdherence } from "./use-client-adherence";

beforeEach(() => vi.clearAllMocks());

describe("the Overview's adherence rails", () => {
  it("are read under the client's adherence key", () => {
    expect(clientAdherenceKey("c1", 14)).toBe("/api/clients/c1/adherence?days=14");
  });

  it("are cleared, then refetched, for that client alone", () => {
    void renderHook(() => useClearClientAdherence()).result.current("c1");

    const [matcher, data, options] = mutate.mock.calls[0] as [(key: unknown) => boolean, unknown, unknown];
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: true });
    expect(matcher(clientAdherenceKey("c1", 14))).toBe(true);
    expect(matcher(clientAdherenceKey("c1", 28))).toBe(true);
    expect(matcher(clientAdherenceKey("c12", 14))).toBe(false);
    expect(matcher("/api/clients/c1/habits")).toBe(false);
    expect(matcher(undefined)).toBe(false);
  });
});
