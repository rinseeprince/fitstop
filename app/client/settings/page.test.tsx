import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SettingsPage from "./page";
import type { Client } from "@/types/check-in";

// Radix RadioGroup measures its indicator via @radix-ui/react-use-size, which
// needs ResizeObserver — jsdom doesn't provide one.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const toastMock = vi.fn();
const swrCall = vi.fn();
const mutateMock = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    coachId: "coach-1",
    name: "Alex Doe",
    email: "alex@example.com",
    active: true,
    includeActivityBurn: true,
    timezone: "America/New_York",
    unitPreference: "imperial",
    weightUnit: "lbs",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function setSWR({
  isLoading = false,
  error,
  data,
}: {
  isLoading?: boolean;
  error?: unknown;
  data?: { success: boolean; data: Client };
} = {}) {
  swrCall.mockImplementation(() => ({
    data: data ?? undefined,
    error,
    isLoading,
    mutate: mutateMock,
  }));
}

function mockFetchOnce(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
}) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  } as Response);
  return fetchSpy;
}

describe("SettingsPage", () => {
  beforeEach(() => {
    toastMock.mockReset();
    swrCall.mockReset();
    mutateMock.mockReset();
    setSWR({ data: { success: true, data: makeClient() } });
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a skeleton while SWR is loading", () => {
    setSWR({ isLoading: true });
    const { container } = render(<SettingsPage />);
    expect(container.querySelector('[aria-label="Loading settings"]')).not.toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("renders an error state with a Try again button on fetch failure", async () => {
    setSWR({ error: new Error("boom") });
    render(<SettingsPage />);

    expect(screen.getByText(/couldn.t load your settings/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it("renders read-only name and email from SWR data", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Alex Doe")).toBeInTheDocument();
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
  });

  it("disables Save when no field is dirty", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("submits only the dirty unitPreference field when toggling Imperial → Metric", async () => {
    const updated = makeClient({ unitPreference: "metric", weightUnit: "kg" });
    const fetchSpy = mockFetchOnce({ body: { success: true, data: updated } });

    render(<SettingsPage />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/metric/i));
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ unitPreference: "metric" });

    // SWR cache populated from the PATCH response, no second round-trip
    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith(
        { success: true, data: updated },
        { revalidate: false },
      ),
    );
    expect(toastMock).toHaveBeenCalledWith({ title: "Settings saved" });
  });

  it("renders the timezone as a read-only device-synced line with no picker", () => {
    render(<SettingsPage />);

    // Read-only display of the stored (device-synced) zone — Session 7.81
    expect(
      screen.getByText("America/New_York (synced from your device)"),
    ).toBeInTheDocument();

    // The manual picker and "Use detected" affordance are gone
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /use detected/i })).toBeNull();
  });

  it("shows a destructive toast when the server returns an error", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      body: { success: false, error: "DB blew up" },
    });

    render(<SettingsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/metric/i));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't save settings",
          description: "DB blew up",
          variant: "destructive",
        }),
      ),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });

});
