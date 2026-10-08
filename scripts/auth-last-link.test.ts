// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin } from "better-auth/plugins";

// The command's own lib/auth, which reaches the database: it records when it
// is loaded, so a test can tell a refusal made before it loads from one made
// after. The parser's tests below build their own Better Auth instead.
const mocks = vi.hoisted(() => {
  const loaded = { auth: false };
  const query = vi.fn();
  const endPool = vi.fn();
  return {
    loaded,
    query,
    endPool,
    authModule: () => {
      loaded.auth = true;
      return { auth: { $context: Promise.resolve({ baseURL: "http://localhost:3000/api/auth" }) }, authPool: { query, end: endPool } };
    },
  };
});
vi.mock("@/lib/auth", () => mocks.authModule());

import { ACCOUNT_DELETED_PAGE, RESET_PASSWORD_PAGE, SET_PASSWORD_PAGE } from "@/lib/constants";
import { emailedLink, newestLiveLink, parseAuthLastLinkArgs, type VerificationRow } from "./auth-last-link";
import { DEV_REF, type ProjectEnv } from "./project-ref";
import { PROD_REF } from "./proof-session";

/**
 * auth:last-link's parser, pinned to what Better Auth 1.7.7 itself writes
 * (docs/BETTER-AUTH-PLAN.md 2.3): the real Better Auth over its memory
 * adapter makes each emailed link, every email's link is captured as the
 * email would carry it, and the parser, reading only the rows Better Auth
 * kept, must print exactly that link.
 */
type Row = Record<string, unknown>;

const PASSWORD = "correct horse battery";

function liveAuth() {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [] };
  const emailed: string[] = [];
  const capture = ({ url }: { url: string }) => {
    emailed.push(url);
    return Promise.resolve();
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-that-is-at-least-thirty-two-characters",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true, sendResetPassword: capture },
    emailVerification: { sendVerificationEmail: capture },
    user: {
      changeEmail: { enabled: true, sendChangeEmailConfirmation: capture },
      deleteUser: { enabled: true, sendDeleteAccountVerification: capture },
    },
    plugins: [admin()],
    telemetry: { enabled: false },
  });
  /** What the parser reads: the verification rows, as the pool would hand them back. */
  const rows = () => db.verification as unknown as VerificationRow[];
  /** Where Better Auth answers, from its own context, as the command reads it. */
  const authBaseURL = async () => (await auth.$context).baseURL;
  return { auth, db, emailed, rows, authBaseURL };
}

type Live = ReturnType<typeof liveAuth>;

/** A login as the owner's coach:create makes one (no password) or as the invite does (a password); verified either way. */
async function makeLogin({ auth }: Live, email: string, password?: string): Promise<string> {
  const { user } = await auth.api.createUser({ body: { email, name: "Proof", password, data: { emailVerified: true } } });
  return user.id;
}

/** The headers of a signed-in session for the login, its cookie as a browser would send it. */
async function signedIn({ auth }: Live, email: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  const cookie = headers
    .getSetCookie()
    .find((set) => set.startsWith("better-auth.session_token="))
    ?.split(";")[0];
  if (!cookie) throw new Error("no session cookie");
  return new Headers({ cookie });
}

describe("auth:last-link's parser, against the rows Better Auth 1.7.7 writes", () => {
  it("prints the Set your password link the owner's coach:create emails: a login with no password yet", async () => {
    const live = liveAuth();
    const userId = await makeLogin(live, "coach@example.com");
    await live.auth.api.requestPasswordReset({ body: { email: "coach@example.com", redirectTo: SET_PASSWORD_PAGE } });
    expect(live.emailed).toHaveLength(1);
    const link = newestLiveLink(live.rows(), userId, new Date(), { authBaseURL: await live.authBaseURL(), hasPassword: false });
    expect(link?.url).toBe(live.emailed[0]);
    expect(link?.landing).toBe(SET_PASSWORD_PAGE);
    expect(new URL(link!.url).searchParams.get("callbackURL")).toBe(SET_PASSWORD_PAGE);
  });

  it("prints the Reset your password link forgot password emails: a login with a password", async () => {
    const live = liveAuth();
    const userId = await makeLogin(live, "client@example.com", PASSWORD);
    await live.auth.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo: RESET_PASSWORD_PAGE } });
    const link = newestLiveLink(live.rows(), userId, new Date(), { authBaseURL: await live.authBaseURL(), hasPassword: true });
    expect(link?.url).toBe(live.emailed[0]);
    expect(link?.landing).toBe(RESET_PASSWORD_PAGE);
  });

  it("prints the delete-account confirmation, landing on the deleted-account notice", async () => {
    const live = liveAuth();
    const userId = await makeLogin(live, "client@example.com", PASSWORD);
    await live.auth.api.deleteUser({ body: { callbackURL: ACCOUNT_DELETED_PAGE }, headers: await signedIn(live, "client@example.com") });
    expect(live.emailed).toHaveLength(1);
    expect(live.db.user).toHaveLength(1);
    const link = newestLiveLink(live.rows(), userId, new Date(), { authBaseURL: await live.authBaseURL(), hasPassword: true });
    expect(link?.url).toBe(live.emailed[0]);
    expect(link?.landing).toBe(ACCOUNT_DELETED_PAGE);
  });

  it("finds nothing for change email: its links carry a token Better Auth signs and never stores", async () => {
    const live = liveAuth();
    const userId = await makeLogin(live, "coach@example.com", PASSWORD);
    await live.auth.api.changeEmail({ body: { newEmail: "new@example.com", callbackURL: "/settings" }, headers: await signedIn(live, "coach@example.com") });
    expect(live.emailed).toHaveLength(1);
    expect(live.emailed[0]).toMatch(/\/api\/auth\/verify-email\?token=[\w-]+\.[\w-]+\.[\w-]+&callbackURL=%2Fsettings$/);
    expect(live.db.verification).toEqual([]);
    expect(newestLiveLink(live.rows(), userId, new Date(), { authBaseURL: await live.authBaseURL(), hasPassword: true })).toBeNull();
  });

  it("prints the newest live link: an older one, an expired one and a used one are never printed", async () => {
    const live = liveAuth();
    const userId = await makeLogin(live, "coach@example.com");
    const context = { authBaseURL: await live.authBaseURL(), hasPassword: false };
    await live.auth.api.requestPasswordReset({ body: { email: "coach@example.com", redirectTo: SET_PASSWORD_PAGE } });
    await live.auth.api.requestPasswordReset({ body: { email: "coach@example.com", redirectTo: SET_PASSWORD_PAGE } });
    const [first, second] = live.rows();
    first.createdAt = new Date(second.createdAt.getTime() - 60_000);
    expect(newestLiveLink(live.rows(), userId, new Date(), context)?.url).toBe(live.emailed[1]);

    second.expiresAt = new Date(Date.now() - 1);
    expect(newestLiveLink(live.rows(), userId, new Date(), context)?.url).toBe(live.emailed[0]);

    const token = new URL(live.emailed[0]).pathname.split("/").pop()!;
    await live.auth.api.resetPassword({ body: { newPassword: PASSWORD, token } });
    expect(newestLiveLink(live.rows(), userId, new Date(), context)).toBeNull();
  });

  it("never prints another login's link", async () => {
    const live = liveAuth();
    const mine = await makeLogin(live, "coach@example.com");
    await makeLogin(live, "other@example.com");
    await live.auth.api.requestPasswordReset({ body: { email: "other@example.com", redirectTo: SET_PASSWORD_PAGE } });
    expect(live.rows()).toHaveLength(1);
    expect(newestLiveLink(live.rows(), mine, new Date(), { authBaseURL: await live.authBaseURL(), hasPassword: false })).toBeNull();
  });

  it.each(["one-time-token:abc", "2fa-otp-abc", "reset-passwordabc", "delete-accountabc", ""])(
    "reads a row of another kind (%j) as no link",
    (identifier) => {
      const row = { identifier, value: "u", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() };
      expect(emailedLink(row, { authBaseURL: "http://localhost:3000/api/auth", hasPassword: true })).toBeNull();
    }
  );
});

describe("parseAuthLastLinkArgs", () => {
  const USAGE = "Usage: npm run auth:last-link -- --email <address>";

  it("reads the address, trimmed and lower-cased as Better Auth stores it", () => {
    expect(parseAuthLastLinkArgs(["--email", "  Coach@Example.com "])).toBe("coach@example.com");
  });

  it.each([
    ["no address", []],
    ["a blank address", ["--email", "  "]],
    ["another flag", ["--email", "a@b.co", "--project", "p"]],
    ["a stray word", ["--email", "a@b.co", "extra"]],
  ])("refuses %s, with the usage", (_label, argv) => {
    expect(() => parseAuthLastLinkArgs(argv)).toThrow(USAGE);
  });
});

/** Each source names `ref`, as a machine linked to it and holding its env would; `databaseRef` names another for DATABASE_URL. */
const envOf = (ref: string, databaseRef = ref): ProjectEnv => ({
  linkedRef: ref,
  databaseUrl: `postgresql://postgres.${databaseRef}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`,
  supabaseUrl: `https://${ref}.supabase.co`,
});

/**
 * The command freshly imported, and nothing that reaches a database loaded
 * yet: whatever loads during the run is the run's own doing. A reset alone
 * keeps a mock built by an earlier test, so it is registered again, and
 * builds anew on its next import.
 */
async function freshCommand() {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => mocks.authModule());
  mocks.loaded.auth = false;
  return (await import("./auth-last-link")).printLastLink;
}

describe("printLastLink: the command, on DEV alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.endPool.mockResolvedValue(undefined);
  });

  it.each([
    ["production's env", envOf(PROD_REF)],
    ["DEV's link with production's DATABASE_URL", envOf(DEV_REF, PROD_REF)],
  ])("refuses %s before anything that reaches a database loads", async (_label, env) => {
    const printLastLink = await freshCommand();
    await expect(printLastLink(["--email", "coach@example.com"], () => env)).rejects.toThrow(`Refused: this run is for project ${DEV_REF}, but`);
    expect(mocks.loaded.auth).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("on DEV: reads the login and its rows, prints the newest live link from where Better Auth answers, and ends the pool", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "user-1", hasPassword: false }] })
      .mockResolvedValueOnce({
        rows: [{ identifier: "reset-password:tok123", value: "user-1", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() }],
      });
    const printLastLink = await freshCommand();
    await printLastLink(["--email", "Coach@Example.com"], () => envOf(DEV_REF));
    expect(mocks.query.mock.calls[0][1]).toEqual(["coach@example.com"]);
    expect(mocks.query.mock.calls[1][1]).toEqual(["user-1"]);
    expect(console.info).toHaveBeenLastCalledWith("http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Fset-password");
    expect(mocks.endPool).toHaveBeenCalledTimes(1);
  });

  it("an address with no login is answered so, and the pool still ends", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const printLastLink = await freshCommand();
    await expect(printLastLink(["--email", "nobody@example.com"], () => envOf(DEV_REF))).rejects.toThrow("No login for nobody@example.com on DEV.");
    expect(mocks.endPool).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();
  });
});
