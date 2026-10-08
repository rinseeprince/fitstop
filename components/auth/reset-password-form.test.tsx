import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { resetPassword: vi.fn(), signOut: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ResetPasswordForm } from "./reset-password-form";
import { PasswordLinkPage } from "./password-link-page";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

const EXPIRED = "This link has expired. Request a new one.";

async function setPassword(password: string, confirm = password, { label = "New Password", button = /update password/i } = {}) {
  await userEvent.type(screen.getByLabelText(label), password);
  await userEvent.type(screen.getByLabelText("Confirm Password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: button }));
}

const signedOut = () => vi.mocked(authClient.signOut).mockResolvedValue({ data: { success: true }, error: null } as never);

describe("the reset link's landing (rule 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedOut();
  });

  it.each([
    ["used or expired (Better Auth's error)", "error=INVALID_TOKEN"],
    ["missing its token", ""],
  ])("a link %s says it has expired and offers a new one, with no form", (_label, query) => {
    search = new URLSearchParams(query);
    render(<ResetPasswordForm landing="reset" />);
    expect(screen.getByRole("alert")).toHaveTextContent(EXPIRED);
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText("New Password")).toBeNull();
  });

  it("sets the new password with the link's token, says so, and goes to /login", async () => {
    search = new URLSearchParams("token=tok123");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: { status: true }, error: null } as never);
    render(<ResetPasswordForm landing="reset" />);
    await setPassword("a brand new password");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(authClient.resetPassword).toHaveBeenCalledWith({ newPassword: "a brand new password", token: "tok123" });
    expect(toast.success).toHaveBeenCalledWith("Password updated");
  });

  it("signs out whoever this browser is signed in as once the password is saved, before the login page, so it shows its form", async () => {
    search = new URLSearchParams("token=tok123");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: { status: true }, error: null } as never);
    render(<ResetPasswordForm landing="reset" />);
    await setPassword("a brand new password");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(authClient.resetPassword)).toBeLessThan(order(authClient.signOut));
    expect(order(authClient.signOut)).toBeLessThan(order(push));
  });

  it.each([
    ["refused", () => vi.mocked(authClient.signOut).mockResolvedValue({ data: null, error: { status: 403 } } as never)],
    ["unreachable", () => vi.mocked(authClient.signOut).mockRejectedValue(new Error("network"))],
  ])("a sign-out that is %s is logged, and the saved password still says so and goes to /login", async (_label, failIt) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    search = new URLSearchParams("token=tok123");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: { status: true }, error: null } as never);
    failIt();
    render(<ResetPasswordForm landing="reset" />);
    await setPassword("a brand new password");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(toast.success).toHaveBeenCalledWith("Password updated");
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^Sign-out after the password was saved/), expect.anything());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses a password under 8 characters, or two that differ, before asking Better Auth", async () => {
    search = new URLSearchParams("token=tok123");
    render(<ResetPasswordForm landing="reset" />);
    await setPassword("short");
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("New Password"));
    await userEvent.clear(screen.getByLabelText("Confirm Password"));
    await setPassword("a brand new password", "a different password");
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(authClient.resetPassword).not.toHaveBeenCalled();
  });

  it("a token used meanwhile says the link has expired, with a way to a new one", async () => {
    search = new URLSearchParams("token=tok123");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: null, error: { status: 400, code: "INVALID_TOKEN" } } as never);
    render(<ResetPasswordForm landing="reset" />);
    await setPassword("a brand new password");
    expect(await screen.findByRole("alert")).toHaveTextContent(EXPIRED);
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(authClient.signOut).not.toHaveBeenCalled();
  });
});

describe("the set-password link's landing (rule 9): the same form in its own words", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedOut();
  });

  const SET = { label: "Password", button: /set password/i };

  it("sets the coach's first password with the link's token, says Password set, and goes to /login", async () => {
    search = new URLSearchParams("token=tok456");
    vi.mocked(authClient.resetPassword).mockResolvedValue({ data: { status: true }, error: null } as never);
    render(<ResetPasswordForm landing="set" />);
    expect(screen.queryByLabelText("New Password")).toBeNull();
    await setPassword("a first password", undefined, SET);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(authClient.resetPassword).toHaveBeenCalledWith({ newPassword: "a first password", token: "tok456" });
    expect(toast.success).toHaveBeenCalledWith("Password set");
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });

  it("refuses a short password before asking Better Auth, as the reset does", async () => {
    search = new URLSearchParams("token=tok456");
    render(<ResetPasswordForm landing="set" />);
    await setPassword("short", undefined, SET);
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(authClient.resetPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["used or expired (Better Auth's error)", "error=INVALID_TOKEN"],
    ["missing its token", ""],
  ])("a link %s says it has expired and offers a new one, with no form", (_label, query) => {
    search = new URLSearchParams(query);
    render(<ResetPasswordForm landing="set" />);
    expect(screen.getByRole("alert")).toHaveTextContent(EXPIRED);
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });
});

describe("the page each link lands on", () => {
  it.each([
    ["reset", "Create new password", "Enter a new password for your account", /update password/i],
    ["set", "Set your password", "Choose a password for your account", /set password/i],
  ] as const)("the %s landing says its own words around the one form", (landing, title, description, button) => {
    search = new URLSearchParams("token=tok789");
    render(<PasswordLinkPage landing={landing} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: button })).toBeInTheDocument();
  });

  it("hosts the form behind its own Suspense boundary, with the fields as its pending frame, so each page stays prerendered", () => {
    const page = readFileSync(join(__dirname, "password-link-page.tsx"), "utf8");
    expect(page).toMatch(
      /<Suspense fallback=\{<NewPasswordFields token=\{null\} landing=\{landing\} \/>\}>\s*<ResetPasswordForm landing=\{landing\} \/>\s*<\/Suspense>/
    );
    expect(page).not.toMatch(/useSearchParams/);
  });

  it.each([
    ["reset-password", "reset"],
    ["set-password", "set"],
  ])("app/%s/page.tsx is that page with the %s landing, and reads no param itself", (folder, landing) => {
    const page = readFileSync(join(__dirname, "..", "..", "app", folder, "page.tsx"), "utf8");
    expect(page).toContain(`<PasswordLinkPage landing="${landing}" />`);
    expect(page).not.toMatch(/useSearchParams/);
  });
});
