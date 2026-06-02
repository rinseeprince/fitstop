import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

import ClientLayout from "./layout";
import type { Client } from "@/types/check-in";

const useAuthMock = vi.fn();
const useClientProfileMock = vi.fn();
const usePathnameMock = vi.fn();
const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => useClientProfileMock(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

vi.mock("@/components/client-portal/nav/client-nav", () => ({
  ClientTopBar: ({ client }: { client: Client | null }) => (
    <div data-testid="top-bar" data-has-client={client ? "true" : "false"} />
  ),
  ClientBottomTabBar: () => <div data-testid="bottom-bar" />,
}));

vi.mock("@/components/client/walkthrough/client-waiting-state", () => ({
  ClientWaitingState: ({ onboardingStatus }: { onboardingStatus?: string }) => (
    <div data-testid="waiting-state" data-status={onboardingStatus} />
  ),
}));

function makeUser(): User {
  return { id: "user-1", email: "alice@example.com" } as User;
}

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    coachId: "coach-1",
    name: "Alice Brown",
    email: "alice@example.com",
    active: true,
    onboardingStatus: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Client;
}

function setAuth({
  user = makeUser() as User | null,
  loading = false,
}: { user?: User | null; loading?: boolean } = {}) {
  useAuthMock.mockReturnValue({ user, loading });
}

function setClientProfile({
  client = null as Client | null,
  isLoading = false,
  error,
  mutate = vi.fn(),
}: {
  client?: Client | null;
  isLoading?: boolean;
  error?: unknown;
  mutate?: () => unknown;
} = {}) {
  useClientProfileMock.mockReturnValue({ client, isLoading, error, mutate });
}

describe("ClientLayout gate ladder", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useClientProfileMock.mockReset();
    usePathnameMock.mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    cleanup();

    usePathnameMock.mockReturnValue("/client");
    setClientProfile();
  });

  it("renders loading state with no chrome while auth is loading", () => {
    setAuth({ user: null, loading: true });
    render(<ClientLayout>page</ClientLayout>);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("top-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-bar")).not.toBeInTheDocument();
  });

  it("redirects to /login when user is not authenticated", async () => {
    setAuth({ user: null, loading: false });
    render(<ClientLayout>page</ClientLayout>);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
    expect(screen.queryByTestId("top-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-bar")).not.toBeInTheDocument();
  });

  it("renders top bar + children with no bottom bar on /client/onboarding", () => {
    setAuth();
    usePathnameMock.mockReturnValue("/client/onboarding");
    setClientProfile({ client: makeClient({ onboardingStatus: "pending_intake" }) });

    render(<ClientLayout>onboarding-children</ClientLayout>);

    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("waiting-state")).not.toBeInTheDocument();
    expect(screen.getByText("onboarding-children")).toBeInTheDocument();
  });

  it("shows top bar with no client + spinner while client profile is loading", () => {
    setAuth();
    setClientProfile({ client: null, isLoading: true });

    render(<ClientLayout>page</ClientLayout>);

    const topBar = screen.getByTestId("top-bar");
    expect(topBar).toBeInTheDocument();
    expect(topBar).toHaveAttribute("data-has-client", "false");
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-bar")).not.toBeInTheDocument();
  });

  it("shows error UI with retry when client profile fails to load", () => {
    setAuth();
    setClientProfile({ client: null, error: new Error("boom") });

    render(<ClientLayout>page</ClientLayout>);

    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(screen.getByText(/couldn.t load your profile/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-bar")).not.toBeInTheDocument();
  });

  it("redirects pending_intake clients to /client/onboarding when on another route", async () => {
    setAuth();
    usePathnameMock.mockReturnValue("/client");
    setClientProfile({ client: makeClient({ onboardingStatus: "pending_intake" }) });

    render(<ClientLayout>page</ClientLayout>);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/client/onboarding"));
  });

  it("renders waiting state with top bar (no bottom bar) when not yet active", () => {
    setAuth();
    setClientProfile({ client: makeClient({ onboardingStatus: "setup_in_progress" }) });

    render(<ClientLayout>page</ClientLayout>);

    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(screen.getByTestId("waiting-state")).toBeInTheDocument();
    expect(screen.getByTestId("waiting-state")).toHaveAttribute(
      "data-status",
      "setup_in_progress",
    );
    expect(screen.queryByTestId("bottom-bar")).not.toBeInTheDocument();
  });

  it("renders full chrome + children for active client", () => {
    setAuth();
    setClientProfile({ client: makeClient({ onboardingStatus: "active" }) });

    render(<ClientLayout>page-content</ClientLayout>);

    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-bar")).toBeInTheDocument();
    expect(screen.getByText("page-content")).toBeInTheDocument();
    expect(screen.queryByTestId("waiting-state")).not.toBeInTheDocument();
  });
});
