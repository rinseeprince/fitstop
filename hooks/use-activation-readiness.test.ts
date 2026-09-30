import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const { mutate, boundMutate, swr, fetcher } = vi.hoisted(() => {
  const boundMutate = vi.fn();
  return {
    mutate: vi.fn(),
    // The mutate SWR binds to the key the reader subscribed with.
    boundMutate,
    swr: vi.fn((..._args: unknown[]) => ({
      data: { success: true, data: { hasTrainingPlan: true, hasNutritionPlan: false, hasHabits: true } },
      error: undefined,
      isLoading: false,
      mutate: boundMutate,
    })),
    fetcher: vi.fn(),
  };
});
vi.mock("swr", () => ({ __esModule: true, default: (...args: unknown[]) => swr(...args), useSWRConfig: () => ({ mutate }) }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: fetcher }));

import { activationReadinessKey, useActivationReadiness, useClearActivationReadiness } from "./use-activation-readiness";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("the activation card's readiness", () => {
  it("is read under one key", () => {
    expect(activationReadinessKey("c1")).toBe("/api/clients/c1/activation-readiness");
  });

  // The repo's coach read: no refetch on focus, three retries a second apart,
  // and a failure logged.
  it("is read with the coach reads' options, only while enabled", () => {
    const { result } = renderHook(() => useActivationReadiness("c1", true));
    const [key, readFn, options] = swr.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(key).toBe("/api/clients/c1/activation-readiness");
    expect(readFn).toBe(fetcher);
    expect(options).toMatchObject({ revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 });
    expect(result.current.readiness).toEqual({ hasTrainingPlan: true, hasNutritionPlan: false, hasHabits: true });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("API request failed");
    (options.onError as (error: unknown) => void)(failure);
    expect(logged).toHaveBeenCalledWith("Failed to load activation readiness:", failure);

    renderHook(() => useActivationReadiness("c1", false));
    renderHook(() => useActivationReadiness("", true));
    expect(swr.mock.calls.slice(1).map((call) => call[0])).toEqual([null, null]);
  });

  it("is read again on a refresh", () => {
    renderHook(() => useActivationReadiness("c1", true)).result.current.refresh();
    expect(boundMutate).toHaveBeenCalledTimes(1);
    expect(boundMutate).toHaveBeenCalledWith();
  });

  it("is cleared, then refetched: the card's items are definite answers", () => {
    void renderHook(() => useClearActivationReadiness()).result.current("c1");
    expect(mutate).toHaveBeenCalledWith("/api/clients/c1/activation-readiness", undefined, { revalidate: true });
  });

  // Derived from the tree: a screen that spells the route itself is a reader
  // the habit writers' clear cannot be proved to reach, and one that reads the
  // key with a useSWR of its own reads it without the coach reads' options.
  describe("the tree", () => {
    const ROOT = join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
      }
    };
    ["components", "hooks"].forEach((dir) => walk(join(ROOT, dir)));
    const sources = files.map((file) => ({ rel: relative(ROOT, file), src: readFileSync(file, "utf8") }));
    const OWN_READ = /\buseSWR\s*[<(]/;

    it("keys the readiness through the builder alone", () => {
      const spelled = sources.filter(({ src }) => /\/activation-readiness[`"']/.test(src)).map(({ rel }) => rel);
      expect(spelled).toEqual(["hooks/use-activation-readiness.ts"]);
    });

    it("reads it through useActivationReadiness alone, and the card and the panel do", () => {
      const ownReaders = sources
        .filter(({ src }) => src.includes("activationReadinessKey(") && OWN_READ.test(src))
        .map(({ rel }) => rel);
      expect(ownReaders).toEqual(["hooks/use-activation-readiness.ts"]);
      const readers = sources.filter(({ src }) => src.includes("useActivationReadiness(")).map(({ rel }) => rel);
      expect(readers).toEqual(
        expect.arrayContaining(["components/clients/client-activation-banner.tsx", "components/coach/floating-intake-panel.tsx"])
      );
    });

    it("recognises what it forbids", () => {
      expect(OWN_READ.test("useSWR<{ data: Readiness }>(activationReadinessKey(id)")).toBe(true);
      expect(OWN_READ.test("useSWR(key, swrFetcher)")).toBe(true);
      expect(OWN_READ.test("const { mutate } = useSWRConfig()")).toBe(false);
    });
  });
});
