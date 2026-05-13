import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import type { ReactNode } from "react";

import { ClientTopBar, ClientBottomTabBar } from "./client-nav";
import type { Client } from "@/types/check-in";

const pushMock = vi.fn();
const logoutMock = vi.fn();
let mockPathname = "/client";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ logout: logoutMock }),
}));

vi.mock("@/components/client/notifications-dropdown", () => ({
  ClientNotificationsDropdown: () => <div data-testid="notifications-mock" />,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => (
    <div data-testid="avatar">{children}</div>
  ),
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test double of Radix AvatarImage
    <img data-testid="avatar-image" src={src} alt={alt ?? ""} />
  ),
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <span data-testid="avatar-fallback">{children}</span>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({
    children,
    ...props
  }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>
      {children}
    </button>
  ),
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "alice@example.com",
    ...overrides,
  } as User;
}

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    coachId: "coach-1",
    name: "Alice Brown",
    email: "alice@example.com",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Client;
}

describe("ClientBottomTabBar", () => {
  beforeEach(() => {
    mockPathname = "/client";
    pushMock.mockReset();
    logoutMock.mockReset();
    cleanup();
  });

  it("renders all four tabs with correct hrefs", () => {
    render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/client");
    expect(screen.getByRole("link", { name: /check-in/i })).toHaveAttribute("href", "/client/check-in");
    expect(screen.getByRole("link", { name: /program/i })).toHaveAttribute("href", "/client/program");
    expect(screen.getByRole("link", { name: /content/i })).toHaveAttribute("href", "/client/resources");
  });

  it("marks Home tab active on exact /client", () => {
    mockPathname = "/client";
    render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("data-active", "true");
  });

  it("does not mark Home tab active on /client/check-in", () => {
    mockPathname = "/client/check-in";
    render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("data-active", "false");
  });

  it("marks Check-in tab active on /client/check-in and nested routes", () => {
    mockPathname = "/client/check-in";
    const { rerender } = render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /check-in/i })).toHaveAttribute("data-active", "true");

    mockPathname = "/client/check-in/abc";
    rerender(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /check-in/i })).toHaveAttribute("data-active", "true");
  });

  it("marks Program tab active on /client/program and nested routes", () => {
    mockPathname = "/client/program";
    const { rerender } = render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /program/i })).toHaveAttribute("data-active", "true");

    mockPathname = "/client/program/details";
    rerender(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /program/i })).toHaveAttribute("data-active", "true");
  });

  it("does not mark Program tab active on /client/training or /client/nutrition", () => {
    mockPathname = "/client/training";
    const { rerender } = render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /program/i })).toHaveAttribute("data-active", "false");

    mockPathname = "/client/nutrition";
    rerender(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /program/i })).toHaveAttribute("data-active", "false");
  });

  it("marks Content tab active on /client/resources and nested routes", () => {
    mockPathname = "/client/resources";
    const { rerender } = render(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /content/i })).toHaveAttribute("data-active", "true");

    mockPathname = "/client/resources/abc";
    rerender(<ClientBottomTabBar />);
    expect(screen.getByRole("link", { name: /content/i })).toHaveAttribute("data-active", "true");
  });

  it("leaves all tabs inactive on /client/training (detail-route subscreen pattern)", () => {
    mockPathname = "/client/training";
    render(<ClientBottomTabBar />);
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link).toHaveAttribute("data-active", "false");
    }
  });
});

describe("ClientTopBar", () => {
  beforeEach(() => {
    mockPathname = "/client";
    pushMock.mockReset();
    logoutMock.mockReset();
    cleanup();
  });

  it("renders logo and brand name", () => {
    render(<ClientTopBar client={makeClient()} user={makeUser()} />);
    expect(screen.getByText("CoachHub")).toBeInTheDocument();
  });

  it("renders avatar fallback with initials from client.name", () => {
    render(<ClientTopBar client={makeClient({ name: "Alice Brown" })} user={makeUser()} />);
    expect(screen.getByTestId("avatar-fallback")).toHaveTextContent("AB");
  });

  it("renders avatar image when client.avatarUrl is provided", () => {
    render(
      <ClientTopBar
        client={makeClient({ avatarUrl: "https://example.com/avatar.png" })}
        user={makeUser()}
      />,
    );
    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      "https://example.com/avatar.png",
    );
  });

  it("falls back to user.email initial when client is null", () => {
    render(<ClientTopBar client={null} user={makeUser({ email: "bob@example.com" })} />);
    expect(screen.getByTestId("avatar-fallback")).toHaveTextContent("B");
  });

  it("exposes a Sign out menu item in the account menu", () => {
    render(<ClientTopBar client={makeClient()} user={makeUser()} />);
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });

  it("calls logout and routes to /login when Sign out is selected", async () => {
    const user = userEvent.setup();
    logoutMock.mockResolvedValue(undefined);

    render(<ClientTopBar client={makeClient()} user={makeUser()} />);
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(logoutMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });
});
