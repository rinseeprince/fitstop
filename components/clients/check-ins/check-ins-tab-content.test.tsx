import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInsTabContent } from "./check-ins-tab-content";
import type { Client, CheckIn } from "@/types/check-in";

const { mockHook, mockInvalidateQueue, mockInvalidateClientCheckIns, search } = vi.hoisted(
  () => ({
    mockHook: vi.fn(),
    mockInvalidateQueue: vi.fn(),
    mockInvalidateClientCheckIns: vi.fn(),
    search: { current: new URLSearchParams("tab=check-ins") },
  })
);
vi.mock("next/navigation", () => ({
  useSearchParams: () => search.current,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-check-in-data", () => ({
  useClientCheckInsInfinite: mockHook,
  useInvalidateCheckInsQueue: () => mockInvalidateQueue,
  useInvalidateClientCheckIns: () => mockInvalidateClientCheckIns,
}));
// The real sheet pulls in three SWR hooks and useToast; the tab's contract with
// it is "open" / "closed" (CONVENTIONS §2, don't break the mock contract).
vi.mock("./check-in-form-sheet", () => ({
  CheckInFormSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="form-sheet" /> : null,
}));
vi.mock("./check-in-detail-view", () => ({
  CheckInDetailView: ({
    checkInId,
    onBack,
    onDone,
  }: {
    checkInId: string;
    onBack: () => void;
    onDone: () => void;
  }) => (
    <div data-testid="detail-view">
      {checkInId}
      <button onClick={onBack}>back</button>
      <button onClick={onDone}>done</button>
    </div>
  ),
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
  const mutate = vi.fn();
  mockHook.mockReturnValue({
    checkIns: [],
    total: 0,
    hasMore: false,
    isLoading: false,
    isLoadingMore: false,
    isError: undefined,
    size: 1,
    setSize: vi.fn(),
    mutate,
    ...overrides,
  });
  return { mutate };
}

function renderTab(onTabChange = vi.fn()) {
  render(<CheckInsTabContent client={client} onTabChange={onTabChange} />);
  return onTabChange;
}

describe("CheckInsTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.current = new URLSearchParams("tab=check-ins");
  });

  it("holds the list's shape with skeletons while loading", () => {
    setHook({ isLoading: true });
    const { container } = render(
      <CheckInsTabContent client={client} onTabChange={vi.fn()} />
    );
    expect(container.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0);
    // Unresolved is never rendered as empty (newdesignsystem → Loading states).
    expect(screen.queryByText(/No check-ins yet/i)).not.toBeInTheDocument();
  });

  // The rail carries the ONLY entry point to the form editor (D4.2), and a
  // coach customises a form before the first check-in exists — so it has to
  // outlive the list's own states.
  it.each([
    ["loading", { isLoading: true }],
    ["empty", { checkIns: [] }],
    ["failed", { isError: new Error("nope") }],
    ["populated", { checkIns: [makeCheckIn()], total: 1 }],
  ])("keeps the Customise action reachable in the %s state", (_label, overrides) => {
    setHook(overrides);
    renderTab();
    expect(
      screen.getByRole("button", { name: "Customise check-in" })
    ).toBeInTheDocument();
  });

  it("opens the form sheet from the rail", async () => {
    const user = userEvent.setup();
    setHook({ checkIns: [makeCheckIn()], total: 1 });
    renderTab();

    expect(screen.queryByTestId("form-sheet")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Customise check-in" }));
    expect(screen.getByTestId("form-sheet")).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    setHook({ checkIns: [] });
    renderTab();
    expect(screen.getByText(/No check-ins yet/i)).toBeInTheDocument();
  });

  it("renders each row as a link to the check-in's own URL", () => {
    setHook({
      checkIns: [makeCheckIn({ id: "ci-9", aiSummary: "Great progress this week." })],
      total: 1,
    });
    renderTab();

    expect(screen.getByText(/Great progress this week/i)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/clients/client-1?tab=check-ins&checkIn=ci-9"
    );
    expect(screen.queryByTestId("detail-view")).not.toBeInTheDocument();
  });

  it("renders the detail in place of the list when ?checkIn= is present", () => {
    search.current = new URLSearchParams("tab=check-ins&checkIn=ci-9");
    setHook({
      checkIns: [makeCheckIn({ id: "ci-9", aiSummary: "Great progress this week." })],
      total: 1,
    });
    renderTab();

    expect(screen.getByTestId("detail-view")).toHaveTextContent("ci-9");
    expect(screen.queryByText(/Great progress this week/i)).not.toBeInTheDocument();
    // The detail replaces the list wholesale — rail included.
    expect(
      screen.queryByRole("button", { name: "Customise check-in" })
    ).not.toBeInTheDocument();
  });

  it("opens a deep link on first render, even while the list is still loading", () => {
    search.current = new URLSearchParams("tab=check-ins&checkIn=ci-9");
    setHook({ isLoading: true });
    const { container } = render(
      <CheckInsTabContent client={client} onTabChange={vi.fn()} />
    );

    expect(screen.getByTestId("detail-view")).toHaveTextContent("ci-9");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("the back row clears the param through the tab handler", async () => {
    const user = userEvent.setup();
    search.current = new URLSearchParams("tab=check-ins&checkIn=ci-9");
    setHook();
    const onTabChange = renderTab();

    await user.click(screen.getByRole("button", { name: "back" }));

    expect(onTabChange).toHaveBeenCalledWith("check-ins", { checkIn: null });
  });

  it("a sent reply refreshes this list, the client's pages and the bell, then returns to the list", async () => {
    const user = userEvent.setup();
    search.current = new URLSearchParams("tab=check-ins&checkIn=ci-9");
    const { mutate } = setHook();
    const onTabChange = renderTab();

    await user.click(screen.getByRole("button", { name: "done" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mockInvalidateClientCheckIns).toHaveBeenCalledWith("client-1");
    expect(mockInvalidateQueue).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("check-ins", { checkIn: null });
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
    renderTab();

    await user.click(screen.getByRole("button", { name: /Load older/i }));
    expect(setSize).toHaveBeenCalledWith(2);
  });
});
