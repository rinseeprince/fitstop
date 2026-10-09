import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const TOKEN = "ef".repeat(32);
vi.mock("next/navigation", () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ push }),
}));
const refetch = vi.fn();
vi.mock("@/lib/auth-client", () => ({ authClient: { useSession: () => ({ refetch }) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import InvitePage from "./page";
import { toast } from "sonner";
import { PRODUCT_NAME } from "@/lib/constants";

const DETAILS = { success: true, invitation: { coachName: "Sam Coach", emailMasked: "s•••e@gmail.com", expiresAt: null } };

/** fetch answering the token lookup with `details` and the accept with `accept`. */
function stubFetch(details: unknown, accept: { status: number; body: unknown }) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url === "/api/invitations/accept"
        ? new Response(JSON.stringify(accept.body), { status: accept.status })
        : new Response(JSON.stringify(details), { status: 200 })
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function createAccount(password = "a strong password") {
  render(<InvitePage />);
  // The page's FormControl wraps each box in its icon's div, so the labels
  // name the div; the boxes are found by their placeholders.
  await userEvent.type(await screen.findByPlaceholderText("Enter your password"), password);
  await userEvent.type(screen.getByPlaceholderText("Confirm your password"), password);
  await userEvent.click(screen.getByRole("button", { name: /create account/i }));
}

describe("the invite page (rule 11)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the coach's name and the masked address, and asks for a password twice", async () => {
    stubFetch(DETAILS, { status: 200, body: { success: true } });
    render(<InvitePage />);
    expect(await screen.findByText("s•••e@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByText(/Sam Coach/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
  });

  it("posts the token and the password alone, learns of the new session, then opens the client home", async () => {
    const fetchMock = stubFetch(DETAILS, { status: 200, body: { success: true } });
    await createAccount();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/client"));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/invitations/accept") as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, password: "a strong password" });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]);
  });

  it("names the product in the invitation and in the welcome", async () => {
    stubFetch(DETAILS, { status: 200, body: { success: true } });
    await createAccount();
    expect(
      screen.getByText(`Sam Coach has invited you to join ${PRODUCT_NAME} to track your fitness journey together.`)
    ).toBeInTheDocument();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Account created successfully! Welcome to ${PRODUCT_NAME}.`));
  });

  it("an address that already has an account says so, and stays", async () => {
    stubFetch(DETAILS, { status: 409, body: { success: false, error: "This email already has an account. Sign in instead." } });
    await createAccount();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't create your account", {
        description: "This email already has an account. Sign in instead.",
      })
    );
    expect(push).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("a used link shows the card that says so", async () => {
    stubFetch({ success: false, error: "This invitation has already been used" }, { status: 200, body: {} });
    render(<InvitePage />);
    expect(await screen.findByText("Invalid Invitation")).toBeInTheDocument();
    expect(screen.getByText("This invitation has already been used")).toBeInTheDocument();
  });
});
