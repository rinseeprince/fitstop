import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSWR, mockUseSWRConfig } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
  mockUseSWRConfig: vi.fn(),
}));
vi.mock("swr", () => ({ default: mockUseSWR, useSWRConfig: mockUseSWRConfig }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import {
  checkInFormTemplatesKey,
  checkInQuestionsKey,
  clientCheckInFormKey,
  useCheckInFormTemplates,
  useCheckInQuestions,
  useClientCheckInForm,
  useInvalidateCheckInFormTemplates,
  useInvalidateCheckInQuestions,
  useInvalidateClientCheckInForm,
} from "./use-check-in-form-config";

const settled = { data: undefined, error: undefined, isLoading: false };

function keyOf(): unknown {
  return mockUseSWR.mock.calls[0][0];
}

/** Runs the matcher the invalidator handed `mutate`. */
function matcherFrom(run: () => void): (key: unknown) => boolean {
  const mutate = vi.fn();
  mockUseSWRConfig.mockReturnValue({ mutate });
  run();
  return mutate.mock.calls[0][0] as (key: unknown) => boolean;
}

describe("check-in form config keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue(settled);
    mockUseSWRConfig.mockReturnValue({ mutate: vi.fn() });
  });

  it("asks for the client's form under its own area key", () => {
    renderHook(() => useClientCheckInForm("client-1"));
    expect(keyOf()).toBe("/api/clients/client-1/check-in-form");
    expect(clientCheckInFormKey("client-1")).toBe(keyOf());
  });

  // Laziness is structural now: these are called from inside the sheet's
  // `SheetContent`, which Radix mounts only while the sheet is open. The
  // `enabled` parameter they used to carry is what let a key flip between real
  // and null inside one mount, which is where the reopen hang lived.
  it.each<[string, () => void]>([
    ["the question bank", () => void useCheckInQuestions()],
    ["the templates", () => void useCheckInFormTemplates()],
  ])("asks for %s unconditionally", (_label, hook) => {
    renderHook(hook);
    expect(keyOf()).not.toBeNull();
  });

  it("has no key for a client with no id", () => {
    renderHook(() => useClientCheckInForm(""));
    expect(keyOf()).toBeNull();
  });

  it("returns stable empty arrays while unresolved", () => {
    const first = renderHook(() => useCheckInQuestions());
    const second = renderHook(() => useCheckInQuestions());
    expect(first.result.current.questions).toBe(second.result.current.questions);

    const t1 = renderHook(() => useCheckInFormTemplates());
    const t2 = renderHook(() => useCheckInFormTemplates());
    expect(t1.result.current.templates).toBe(t2.result.current.templates);
  });
});

describe("check-in form config invalidators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue(settled);
  });

  it("the client-form invalidator matches that client's area and nothing else", () => {
    const match = matcherFrom(() => {
      const { result } = renderHook(() => useInvalidateClientCheckInForm());
      void result.current("client-1");
    });

    expect(match("/api/clients/client-1/check-in-form")).toBe(true);
    expect(match("/api/clients/client-2/check-in-form")).toBe(false);
    expect(match("/api/clients/client-1/check-ins")).toBe(false);
    expect(match(["/api/clients/client-1/check-in-form"])).toBe(false);
  });

  it("the bank invalidator matches the questions area, not the queue", () => {
    const match = matcherFrom(() => {
      const { result } = renderHook(() => useInvalidateCheckInQuestions());
      void result.current();
    });

    expect(match(checkInQuestionsKey)).toBe(true);
    expect(match(`${checkInQuestionsKey}/q-1`)).toBe(true);
    expect(match("/api/check-ins/unreviewed")).toBe(false);
  });

  it("the templates invalidator matches the forms area, not the queue", () => {
    const match = matcherFrom(() => {
      const { result } = renderHook(() => useInvalidateCheckInFormTemplates());
      void result.current();
    });

    expect(match(checkInFormTemplatesKey)).toBe(true);
    expect(match("/api/check-ins/unreviewed")).toBe(false);
  });
});
