import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The Account card's Change password: its dialog calls Better Auth's client.
vi.mock("@/lib/auth-client", () => ({ authClient: { changePassword: vi.fn() } }));
// Who is signed in, which the Account card's Change email reads: Better Auth's session.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Alex Doe", email: "alex@example.com" } }),
}));
// The notice that says when a change-of-email link failed reads the address
// (useSearchParams); it is tested beside its file and stands in here by name.
vi.mock("@/components/auth/change-email-link-notice", () => ({
  ChangeEmailLinkNotice: ({ landing }: { landing: string }) => <output aria-label="Link notice" data-landing={landing} />,
}));

import SettingsPage from "./page";
import { authClient } from "@/lib/auth-client";
import type { Client } from "@/types/check-in";

// Radix RadioGroup measures its indicator via @radix-ui/react-use-size, which
// needs ResizeObserver — jsdom doesn't provide one.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const swrCall = vi.fn();
const mutateMock = vi.fn();
const invalidateUnitPreferenceMock = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

// units-context reaches auth-context, which constructs the browser Supabase
// client and throws without env vars — the same mock ~20 other suites carry
// since Phase 3. The invalidator's own two-cache behaviour is proven against
// the real provider in components/coach/settings-units-card.test.tsx; what
// this suite owns is whether THIS page calls it at all.
vi.mock("@/contexts/units-context", () => ({
  useInvalidateUnitPreference: () => invalidateUnitPreferenceMock,
}));

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    coachId: "coach-1",
    name: "Alex Doe",
    email: "alex@example.com",
    active: true,
    timezone: "America/New_York",
    unitPreference: "imperial",
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
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    swrCall.mockReset();
    mutateMock.mockReset();
    invalidateUnitPreferenceMock.mockReset();
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

  it("the skeleton holds a card for each card the page draws, so nothing moves when it lands", () => {
    setSWR({ isLoading: true });
    const { container } = render(<SettingsPage />);
    const pending = container.querySelectorAll('[aria-label="Loading settings"] [data-slot="card"]').length;
    cleanup();
    setSWR({ data: { success: true, data: makeClient() } });
    render(<SettingsPage />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(pending);
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
    const updated = makeClient({ unitPreference: "metric" });
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
    expect(toastMock.success).toHaveBeenCalledWith("Settings saved");
  });

  it("invalidates the unit-preference cache after a successful unit change", async () => {
    mockFetchOnce({
      body: { success: true, data: makeClient({ unitPreference: "metric" }) },
    });

    render(<SettingsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/metric/i));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Without this the client saves Metric and the portal keeps rendering
    // pounds until a full reload, because every unit-bearing number reads
    // useUnits() → /api/me/unit-preference, not /api/client/me.
    await waitFor(() =>
      expect(invalidateUnitPreferenceMock).toHaveBeenCalledTimes(1),
    );
  });

  it("does not invalidate the unit-preference cache when the save fails", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      body: { success: false, error: "DB blew up" },
    });

    render(<SettingsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/metric/i));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(invalidateUnitPreferenceMock).not.toHaveBeenCalled();
  });

  it("seeds the radio group from the client's stored preference, not a hardcoded default", () => {
    // mapClientRow normalizes a NULL column to metric; the page must show what
    // the rest of the portal is already rendering rather than its own fallback.
    setSWR({
      data: { success: true, data: makeClient({ unitPreference: "metric" }) },
    });
    render(<SettingsPage />);

    expect(screen.getByLabelText(/metric/i)).toBeChecked();
    expect(screen.getByLabelText(/imperial/i)).not.toBeChecked();
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
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't save settings", {
        description: "DB blew up",
      }),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("puts the Account card between Profile and Units, with Change password and Change email (rules 13 and 17, D18)", () => {
    render(<SettingsPage />);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(titles).toEqual(["Profile", "Account", "Units", "Timezone"]);
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change email" })).toBeEnabled();
  });

  it.each([
    ["the settings", { data: { success: true, data: makeClient() } }],
    ["the skeleton, while they load", { isLoading: true }],
    ["the error, when they can't load", { error: new Error("boom") }],
  ])("hosts the notice that says when a change-of-email link failed, for links landing here, beside %s", (_label, swr) => {
    setSWR(swr);
    render(<SettingsPage />);
    expect(screen.getByLabelText("Link notice")).toHaveAttribute("data-landing", "/client/settings");
  });

  it("Change password opens its dialog, and neither it nor the dialog's own submit reaches the settings form", async () => {
    vi.mocked(authClient.changePassword).mockResolvedValue({ data: { token: "t", user: {} }, error: null } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Change password" })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Current password"), "my current password");
    await user.type(within(dialog).getByLabelText("New password"), "a brand new password");
    await user.type(within(dialog).getByLabelText("Confirm new password"), "a brand new password");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Password changed"));
    expect(authClient.changePassword).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalledWith("Settings saved");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

});
