import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, type Cache } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import NutritionLogPage from "./page";

// Real SWR, not the mock the sibling test uses: what this pins is how the log
// loads across a save and across two visits, which a mocked hook cannot show.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const TODAY = getTodayDateStringInTimezone("UTC");
const LOG_URL = `/api/client/daily-logs/${TODAY}/nutrition`;

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

/** The day's nutrition as the server has it. */
const nutrition = (calories: number) => ({
  success: true,
  data: {
    consumed: { calories, proteinG: 150, carbsG: 200, fatG: 60 },
    target: { calories: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
    source: "log",
    editable: true,
  },
});

/** The server's log, visit by visit. */
function serveLogs(...visits: ReturnType<typeof nutrition>[]) {
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
      {open ? <NutritionLogPage /> : null}
    </SWRConfig>
  );
}

describe("Nutrition log page through real SWR", () => {
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
    serveLogs(nutrition(1800));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: {} }),
    } as Response);
    const user = userEvent.setup();
    const { container } = render(tree(cache, true));

    await waitFor(() => expect(screen.getByLabelText(/calories/i)).toHaveValue(1800));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Log nutrition")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    expect(logReads()).toBe(1);
  });

  it("reopened inside the dedupe window, fills from a fresh load rather than the last visit's copy", async () => {
    // Between the visits the day was logged on another device.
    serveLogs(nutrition(1800), nutrition(2050));
    const { container, rerender } = render(tree(cache, true));
    await waitFor(() => expect(screen.getByLabelText(/calories/i)).toHaveValue(1800));

    rerender(tree(cache, false));
    rerender(tree(cache, true));
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByLabelText(/calories/i)).toHaveValue(2050));
    expect(logReads()).toBe(2);
  });
});
