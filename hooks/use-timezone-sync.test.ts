import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { getDeviceTimeZoneMock } = vi.hoisted(() => ({
  getDeviceTimeZoneMock: vi.fn(),
}));
vi.mock("@/lib/date-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-helpers")>();
  return { ...actual, getDeviceTimeZone: getDeviceTimeZoneMock };
});

import { useTimezoneSync } from "./use-timezone-sync";

describe("useTimezoneSync", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PATCHes the client settings endpoint when device differs from stored", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");

    renderHook(() => useTimezoneSync("client", "UTC"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/client/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      timezone: "Europe/London",
    });
  });

  it("PATCHes the coach settings endpoint for the coach scope", () => {
    getDeviceTimeZoneMock.mockReturnValue("America/New_York");

    renderHook(() => useTimezoneSync("coach", "UTC"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/coach/settings");
    expect(JSON.parse(init.body as string)).toEqual({
      timezone: "America/New_York",
    });
  });

  it("re-syncs after travel (stored is a real zone but device moved)", () => {
    getDeviceTimeZoneMock.mockReturnValue("America/New_York");

    renderHook(() => useTimezoneSync("client", "Europe/London"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      timezone: "America/New_York",
    });
  });

  it("no-ops when device matches stored", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");

    renderHook(() => useTimezoneSync("client", "Europe/London"));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops while the stored timezone has not loaded yet", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");

    renderHook(() => useTimezoneSync("client", undefined));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops when the device timezone is unavailable", () => {
    getDeviceTimeZoneMock.mockReturnValue(undefined);

    renderHook(() => useTimezoneSync("client", "UTC"));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("PATCHes only once per mount even when the stored value stays stale", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");

    // Stored value never updates (SWR cache still stale after the PATCH) —
    // a rerender must not fire a second PATCH.
    const { rerender } = renderHook(
      ({ stored }: { stored: string }) => useTimezoneSync("client", stored),
      { initialProps: { stored: "UTC" } },
    );
    rerender({ stored: "UTC" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fires once the profile resolves after an initial loading render", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");

    const { rerender } = renderHook(
      ({ stored }: { stored: string | undefined }) =>
        useTimezoneSync("client", stored),
      { initialProps: { stored: undefined as string | undefined } },
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    rerender({ stored: "UTC" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-arms after logout so the next login in the same SPA session can sync", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");

    // Coach A syncs, logs out (stored -> undefined), coach B logs in. The
    // mount never unmounts (root-layout sidebar), so the guard must reset.
    const { rerender } = renderHook(
      ({ stored }: { stored: string | undefined }) =>
        useTimezoneSync("coach", stored),
      { initialProps: { stored: "UTC" as string | undefined } },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    rerender({ stored: undefined }); // logout
    rerender({ stored: "America/New_York" }); // coach B, stale stored zone

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("swallows network errors silently (fire-and-forget)", () => {
    getDeviceTimeZoneMock.mockReturnValue("Europe/London");
    fetchSpy.mockRejectedValue(new Error("offline"));

    expect(() => {
      renderHook(() => useTimezoneSync("client", "UTC"));
    }).not.toThrow();
  });
});
