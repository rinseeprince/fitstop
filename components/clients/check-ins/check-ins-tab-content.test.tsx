import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInsTabContent } from "./check-ins-tab-content";
import type { Client, CheckIn } from "@/types/check-in";

const { mockHook } = vi.hoisted(() => ({ mockHook: vi.fn() }));
vi.mock("@/hooks/use-check-in-data", () => ({
  useClientCheckInsInfinite: mockHook,
}));
vi.mock("@/components/check-in/check-in-detail-modal", () => ({
  CheckInDetailModal: ({ checkInId }: { checkInId: string | null }) =>
    checkInId ? <div data-testid="detail-modal">{checkInId}</div> : null,
}));

const client = { id: "client-1", name: "Jane Doe", email: "j@d.com" } as Client;

function makeCheckIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    id: "ci-1",
    clientId: "client-1",
    status: "reviewed",
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-01T10:00:00Z",
    ...overrides,
  };
}

function setHook(overrides: Record<string, unknown> = {}) {
  mockHook.mockReturnValue({
    checkIns: [],
    total: 0,
    hasMore: false,
    isLoading: false,
    isLoadingMore: false,
    isError: undefined,
    size: 1,
    setSize: vi.fn(),
    mutate: vi.fn(),
    ...overrides,
  });
}

describe("CheckInsTabContent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a loading spinner", () => {
    setHook({ isLoading: true });
    const { container } = render(<CheckInsTabContent client={client} />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByText(/No check-ins yet/i)).not.toBeInTheDocument();
  });

  it("shows the empty state", () => {
    setHook({ checkIns: [] });
    render(<CheckInsTabContent client={client} />);
    expect(screen.getByText(/No check-ins yet/i)).toBeInTheDocument();
  });

  it("renders the list and opens the detail modal on row click", async () => {
    const user = userEvent.setup();
    setHook({
      checkIns: [
        makeCheckIn({ id: "ci-9", aiSummary: "Great progress this week." }),
      ],
      total: 1,
    });
    render(<CheckInsTabContent client={client} />);

    expect(screen.getByText(/Great progress this week/i)).toBeInTheDocument();

    await user.click(screen.getByText(/Great progress this week/i));
    expect(screen.getByTestId("detail-modal")).toHaveTextContent("ci-9");
  });

  it("pages when Load older is clicked", async () => {
    const user = userEvent.setup();
    const setSize = vi.fn();
    setHook({
      checkIns: [makeCheckIn()],
      total: 50,
      hasMore: true,
      size: 1,
      setSize,
    });
    render(<CheckInsTabContent client={client} />);

    await user.click(screen.getByRole("button", { name: /Load older/i }));
    expect(setSize).toHaveBeenCalledWith(2);
  });
});
