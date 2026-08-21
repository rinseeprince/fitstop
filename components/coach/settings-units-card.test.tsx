import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import type { Coach } from "@/types/check-in";

// The card is mounted inside the REAL UnitsProvider so the real
// useInvalidateUnitPreference runs. Only its two dependencies are mocked: swr
// (to capture mutate) and auth-context (which otherwise constructs the browser
// Supabase client and throws without env vars).

const mutateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: () => ({
    data: undefined,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// isMeKey is part of this mock DELIBERATELY, because units-context imports it
// and calls `mutate(isMeKey)`. Verified by mutation 2026-08-06: deleting it
// from this factory fails the both-caches test below (one mutate call instead
// of two — vitest raises on the missing named export rather than handing the
// module `undefined`). Either way it fails loudly, which is the point; the
// identity assertion below then pins WHICH matcher was passed.
const authState = {
  user: { id: "user-1" } as { id: string } | null,
  coach: null as Coach | null,
  loading: false,
};

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => authState,
  isMeKey: (key: unknown): boolean =>
    Array.isArray(key) && key[0] === "/api/auth/me",
}));

import { isMeKey } from "@/contexts/auth-context";
import { UnitsProvider } from "@/contexts/units-context";
import { SettingsUnitsCard } from "./settings-units-card";

function makeCoach(unitPreference: Coach["unitPreference"]): Coach {
  return {
    id: "coach-1",
    name: "Test Coach",
    email: "coach@example.com",
    timezone: "Europe/London",
    unitPreference,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

function renderCard() {
  return render(
    <UnitsProvider>
      <SettingsUnitsCard />
    </UnitsProvider> as ReactNode,
  );
}

function mockFetchOnce(response: { ok?: boolean; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: response.ok ?? true,
    json: () => Promise.resolve(response.body),
  } as Response);
}

describe("SettingsUnitsCard", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    toastMock.mockReset();
    authState.user = { id: "user-1" };
    authState.coach = makeCoach("metric");
    authState.loading = false;
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds the segmented control from the coach's own preference", () => {
    authState.coach = makeCoach("imperial");
    renderCard();

    // The active segment is the one carrying the shipped active recipe — the
    // WHITE PILL. Weight is deliberately constant across states since
    // 2026-08-21 (docs/newdesignsystem.md → Segmented control), so
    // `font-semibold` is no longer the marker and asserting it pinned a spec
    // rather than the behaviour this test is about.
    const imperial = screen.getByRole("button", { name: /imperial/i });
    expect(imperial.className).toContain("bg-white");
    const metric = screen.getByRole("button", { name: /^metric/i });
    expect(metric.className).not.toContain("bg-white");
  });

  it("disables Save until a different unit is picked", async () => {
    renderCard();
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();

    const user = userEvent.setup();
    // Re-picking the current value is not a change.
    await user.click(screen.getByRole("button", { name: /^metric/i }));
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /imperial/i }));
    expect(save).not.toBeDisabled();
  });

  it("PATCHes only unitPreference, never the timezone", async () => {
    const fetchSpy = mockFetchOnce({ body: { success: true } });
    renderCard();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /imperial/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/coach/settings");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({
      unitPreference: "imperial",
    });
  });

  it("invalidates BOTH preference caches, not just the units route", async () => {
    mockFetchOnce({ body: { success: true } });
    renderCard();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /imperial/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(2));

    // First: an area matcher for /api/me/unit-preference.
    const unitsMatcher = mutateMock.mock.calls[0][0] as (k: unknown) => boolean;
    expect(typeof unitsMatcher).toBe("function");
    expect(unitsMatcher(["/api/me/unit-preference", "user-1"])).toBe(true);
    expect(unitsMatcher(["/api/auth/me", "user-1"])).toBe(false);

    // Second: auth-context's own isMeKey, by identity. The coach's preference
    // also rides on /api/auth/me inside coach.unitPreference, so clearing only
    // the first leaves useAuth().coach stale with nothing erroring. Identity
    // (not just "a function") pins which of the two matchers this was, so
    // passing the same one twice cannot pass.
    expect(mutateMock.mock.calls[1][0]).toBe(isMeKey);
  });

  it("does not invalidate when the save fails, and surfaces the error", async () => {
    mockFetchOnce({ ok: false, body: { success: false, error: "DB blew up" } });
    renderCard();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /imperial/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't save units",
          description: "DB blew up",
          variant: "destructive",
        }),
      ),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("blocks the control while the preference is still loading", () => {
    authState.coach = null;
    authState.loading = true;
    renderCard();

    expect(screen.getByRole("button", { name: /^metric/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /imperial/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
});
