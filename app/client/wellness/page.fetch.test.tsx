import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, type Cache } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import WellnessLogPage from "./page";

// Real SWR, not the mock the sibling test uses: what this pins is how the log
// loads across a save and across two visits, which a mocked hook cannot show.

// jsdom doesn't implement ResizeObserver; the Radix Slider needs it to render.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const TODAY = getTodayDateStringInTimezone("UTC");
const LOG_URL = `/api/client/daily-logs/${TODAY}/wellness`;

const { pushMock, toastMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: (key: string) => (key === "date" ? TODAY : null) }),
}));
vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => ({
    client: { timezone: "UTC", logsOpenFrom: null },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

/** The day's wellness as the server has it. */
const wellness = (mood: number) => ({
  success: true,
  data: { mood, energy: 6, sleep: 7, stress: 3, soreness: 4, editable: true },
});

/** The server's log, visit by visit. */
function serveLogs(...visits: ReturnType<typeof wellness>[]) {
  const queue = [...visits];
  vi.mocked(swrFetcher).mockImplementation((url: string) =>
    url === LOG_URL
      ? Promise.resolve(queue.shift())
      : Promise.reject(new Error(`Unexpected read: ${url}`)),
  );
}

const logReads = () =>
  vi.mocked(swrFetcher).mock.calls.filter(([url]) => url === LOG_URL).length;

// One SWR cache for the whole test, kept across the page closing and opening.
function tree(cache: Cache, open: boolean) {
  return (
    <SWRConfig value={{ provider: () => cache }}>
      {open ? <WellnessLogPage /> : null}
    </SWRConfig>
  );
}

describe("Wellness log page through real SWR", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Map() as unknown as Cache;
    vi.mocked(swrFetcher).mockReset();
    pushMock.mockReset();
    toastMock.success.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays on the log after Save until Home replaces it", async () => {
    serveLogs(wellness(4));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: {} }),
    } as Response);
    const user = userEvent.setup();
    const { container } = render(tree(cache, true));

    await user.click(await screen.findByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Log wellness")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    expect(logReads()).toBe(1);
  });

  it("reopened inside the dedupe window, fills from a fresh load rather than the last visit's copy", async () => {
    // Between the visits the day was logged on another device.
    serveLogs(wellness(4), wellness(3));
    const { container, rerender } = render(tree(cache, true));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /great/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    rerender(tree(cache, false));
    rerender(tree(cache, true));
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /good/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(logReads()).toBe(2);
  });
});
