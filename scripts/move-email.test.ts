import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// What reaches a database: Better Auth's module (its pool) and the account
// service. Each records when it is loaded, so a test can tell a refusal made
// before they load from one made after.
const mocks = vi.hoisted(() => {
  const loaded = { auth: false, accountService: false };
  const moveLoginEmail = vi.fn();
  const backgroundWorkSettled = vi.fn();
  const endPool = vi.fn();
  return {
    loaded,
    moveLoginEmail,
    backgroundWorkSettled,
    endPool,
    authModule: () => {
      loaded.auth = true;
      return { authPool: { end: endPool }, backgroundWorkSettled };
    },
    accountServiceModule: () => {
      loaded.accountService = true;
      return { moveLoginEmail };
    },
  };
});
vi.mock("@/lib/auth", () => mocks.authModule());
vi.mock("@/services/account-service", () => mocks.accountServiceModule());

import { parseMoveEmailArgs } from "./move-email";
import { DEV_REF, type ProjectEnv } from "./project-ref";
import { PROD_REF } from "./proof-session";

/** npm run auth:move-email's flags (docs/BETTER-AUTH-PLAN.md rule 19), as npm hands them over after `--`. */
const USAGE = "Usage: npm run auth:move-email -- --project <ref> --email <current> --to <new>";
const FLAGS = ["--project", DEV_REF, "--email", "  Lost@Example.com ", "--to", " Found@Example.com"];

describe("parseMoveEmailArgs", () => {
  it("reads the project and both addresses, lower-cased as Better Auth stores them, each trimmed", () => {
    expect(parseMoveEmailArgs(FLAGS)).toEqual({ project: DEV_REF, email: "lost@example.com", to: "found@example.com" });
    expect(parseMoveEmailArgs(["--project=p", "--email=a@b.co", "--to=c@d.co"])).toEqual({ project: "p", email: "a@b.co", to: "c@d.co" });
  });

  it.each(["--project", "--email", "--to"])("refuses a run without %s, with the usage", (flag) => {
    const at = FLAGS.indexOf(flag);
    expect(() => parseMoveEmailArgs([...FLAGS.slice(0, at), ...FLAGS.slice(at + 2)])).toThrow(USAGE);
  });

  it.each([
    ["a blank project", ["--project", " ", "--email", "a@b.co", "--to", "c@d.co"]],
    ["a blank address", ["--project", "p", "--email", "", "--to", "c@d.co"]],
    ["a blank new address", ["--project", "p", "--email", "a@b.co", "--to", "  "]],
    ["a flag it does not know", [...FLAGS, "--force"]],
    ["a stray word", [...FLAGS, "extra"]],
  ])("refuses %s, with the usage", (_label, argv) => {
    expect(() => parseMoveEmailArgs(argv)).toThrow(USAGE);
  });

  it.each([
    ["the current address", ["--project", "p", "--email", "lost", "--to", "c@d.co"], "lost"],
    ["the new address", ["--project", "p", "--email", "a@b.co", "--to", "found@"], "found@"],
  ])("refuses %s when it is not an email address, before anything is read", (_label, argv, value) => {
    expect(() => parseMoveEmailArgs(argv)).toThrow(`Refused: ${value} is not an email address. Nothing was read or written.`);
  });

  it("refuses a move to the address the login has", () => {
    expect(() => parseMoveEmailArgs(["--project", "p", "--email", "Same@Example.com", "--to", "same@example.com"])).toThrow(
      "Refused: --email and --to name the same address. Nothing was read or written."
    );
  });
});

/** Each source names the same project, as a machine linked to it and holding its env would. */
const envOf = (ref: string): ProjectEnv => ({
  linkedRef: ref,
  databaseUrl: `postgresql://postgres.${ref}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`,
  supabaseUrl: `https://${ref}.supabase.co`,
});

const CURRENT = "lost@example.com";
const NEW = "found@example.com";
const flagsFor = (project: string) => ["--project", project, "--email", CURRENT, "--to", NEW];

/**
 * The command freshly imported, and nothing that reaches a database loaded
 * yet: whatever loads during the run is the run's own doing. A reset alone
 * keeps a mock built by an earlier test, so each mock is registered again,
 * and builds anew on its next import.
 */
async function freshCommand() {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => mocks.authModule());
  vi.doMock("@/services/account-service", () => mocks.accountServiceModule());
  mocks.loaded.auth = false;
  mocks.loaded.accountService = false;
  return (await import("./move-email")).moveEmail;
}

describe("moveEmail: the command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.moveLoginEmail.mockResolvedValue({ moved: true, userId: "user-1", sessionsEnded: 3 });
    mocks.backgroundWorkSettled.mockResolvedValue(undefined);
    mocks.endPool.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses production's ref against DEV's env before anything that reaches a database loads", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    const moveEmail = await freshCommand();
    await expect(moveEmail(flagsFor(PROD_REF), () => envOf(DEV_REF))).rejects.toThrow(`Refused: this run is for project ${PROD_REF}`);
    expect(mocks.loaded).toEqual({ auth: false, accountService: false });
    expect(mocks.moveLoginEmail).not.toHaveBeenCalled();
  });

  it("refuses a run for production whose reset link would open this machine, before anything loads", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const moveEmail = await freshCommand();
    await expect(moveEmail(flagsFor(PROD_REF), () => envOf(PROD_REF))).rejects.toThrow(
      `Refused: the moved login on ${PROD_REF} is emailed a link to BETTER_AUTH_URL, http://localhost:3000, and it must be the app's https address.`
    );
    expect(mocks.loaded).toEqual({ auth: false, accountService: false });
  });

  it("on DEV: moves the login, waits for the email's send before the pool ends, and prints the move, its Google accounts unlinked, the sessions ended and the link's landing", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const moveEmail = await freshCommand();
    await moveEmail(flagsFor(DEV_REF), () => envOf(DEV_REF));
    expect(mocks.moveLoginEmail).toHaveBeenCalledWith({ email: CURRENT, to: NEW });
    expect(mocks.backgroundWorkSettled.mock.invocationCallOrder[0]).toBeLessThan(mocks.endPool.mock.invocationCallOrder[0]);
    expect(vi.mocked(console.info).mock.calls.map(([line]) => line)).toEqual([
      `Moved the login of ${CURRENT} to ${NEW} (user id user-1), its coach and client rows with it.`,
      "Any Google account linked to it is unlinked: none signs it in any more.",
      "Ended 3 session(s): every device it was signed in on is signed out.",
      `"Reset your password" sent to ${NEW}. Its link lasts one hour and lands on http://localhost:3000/reset-password.`,
      `If it doesn't arrive: npm run auth:last-link -- --email ${NEW}`,
    ]);
  });

  it("for production on its https address: moved, and the person is pointed to Forgot your password, auth:last-link being DEV's", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    const moveEmail = await freshCommand();
    await moveEmail(flagsFor(PROD_REF), () => envOf(PROD_REF));
    expect(vi.mocked(console.info)).toHaveBeenLastCalledWith(`If it doesn't arrive, they can click "Forgot your password?" on the sign-in page.`);
  });

  it.each([
    ["an address with no login", { moved: false, refusal: "no_login" }, `Refused: ${CURRENT} has no login. Nothing was changed.`],
    ["a new address a client row holds", { moved: false, refusal: "in_use", heldBy: "a client row" }, `Refused: ${NEW} is in use: a client row holds it. Nothing was changed.`],
    ["a new address a login holds", { moved: false, refusal: "in_use", heldBy: "a login" }, `Refused: ${NEW} is in use: a login holds it. Nothing was changed.`],
  ])("refuses %s with nothing changed, says so, and the pool still ends", async (_label, result, sentence) => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    mocks.moveLoginEmail.mockResolvedValue(result);
    const moveEmail = await freshCommand();
    await expect(moveEmail(flagsFor(DEV_REF), () => envOf(DEV_REF))).rejects.toThrow(sentence);
    expect(mocks.endPool).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();
  });

  it("a move left unfinished is thrown as the service says it, and the pool still ends after the email's send", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const unfinished = new Error(`The login moved to ${NEW} with its coach and client rows, but its sessions could not be ended: pool down.`);
    mocks.moveLoginEmail.mockRejectedValue(unfinished);
    const moveEmail = await freshCommand();
    await expect(moveEmail(flagsFor(DEV_REF), () => envOf(DEV_REF))).rejects.toBe(unfinished);
    expect(mocks.backgroundWorkSettled).toHaveBeenCalledTimes(1);
    expect(mocks.endPool).toHaveBeenCalledTimes(1);
  });
});
