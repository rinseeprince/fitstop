import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIError } from "better-auth/api";

// What reaches a database: Better Auth's module (its pool) and the login
// service. Each records when it is loaded, so a test can tell a refusal made
// before they load from one made after.
const mocks = vi.hoisted(() => {
  const loaded = { auth: false, loginService: false };
  const createCoachLogin = vi.fn();
  const backgroundWorkSettled = vi.fn();
  const endPool = vi.fn();
  return {
    loaded,
    createCoachLogin,
    backgroundWorkSettled,
    endPool,
    authModule: () => {
      loaded.auth = true;
      return { authPool: { end: endPool }, backgroundWorkSettled };
    },
    loginServiceModule: () => {
      loaded.loginService = true;
      return { ADDRESS_TAKEN: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", createCoachLogin };
    },
  };
});
vi.mock("@/lib/auth", () => mocks.authModule());
vi.mock("@/services/login-service", () => mocks.loginServiceModule());

import { parseCreateCoachArgs } from "./create-coach";
import { DEV_REF, type ProjectEnv } from "./project-ref";
import { PROD_REF } from "./proof-session";

/** npm run coach:create's flags (docs/BETTER-AUTH-PLAN.md rule 14), as npm hands them over after `--`. */
const USAGE = 'Usage: npm run coach:create -- --project <ref> --email <address> --name "<name>"';
const FLAGS = ["--project", DEV_REF, "--email", "  New.Coach@Example.com ", "--name", "  Smoke coach  "];

describe("parseCreateCoachArgs", () => {
  it("reads the project, the address lower-cased as Better Auth stores it, and the name, each trimmed", () => {
    expect(parseCreateCoachArgs(FLAGS)).toEqual({ project: DEV_REF, email: "new.coach@example.com", name: "Smoke coach" });
    expect(parseCreateCoachArgs(["--project=p", "--email=a@b.co", "--name=Two words"])).toEqual({ project: "p", email: "a@b.co", name: "Two words" });
  });

  it.each(["--project", "--email", "--name"])("refuses a run without %s, with the usage", (flag) => {
    const at = FLAGS.indexOf(flag);
    expect(() => parseCreateCoachArgs([...FLAGS.slice(0, at), ...FLAGS.slice(at + 2)])).toThrow(USAGE);
  });

  it.each([
    ["a blank name", ["--project", "p", "--email", "a@b.co", "--name", "   "]],
    ["a blank address", ["--project", "p", "--email", " ", "--name", "Coach"]],
    ["a blank project", ["--project", "", "--email", "a@b.co", "--name", "Coach"]],
  ])("refuses %s, with the usage", (_label, argv) => {
    expect(() => parseCreateCoachArgs(argv)).toThrow(USAGE);
  });

  it.each([
    ["a flag it does not know, a role among them", [...FLAGS, "--role", "admin"]],
    ["a stray word", [...FLAGS, "extra"]],
    ["a flag with no value", ["--project", "p", "--email", "a@b.co", "--name"]],
  ])("refuses %s, with the usage", (_label, argv) => {
    expect(() => parseCreateCoachArgs(argv)).toThrow(USAGE);
  });
});

/** Each source names the same project, as a machine linked to it and holding its env would. */
const envOf = (ref: string): ProjectEnv => ({
  linkedRef: ref,
  databaseUrl: `postgresql://postgres.${ref}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`,
  supabaseUrl: `https://${ref}.supabase.co`,
});

const ADDRESS = "new.coach@example.com";
const flagsFor = (project: string) => ["--project", project, "--email", ADDRESS, "--name", "New Coach"];

/**
 * The command freshly imported, and nothing that reaches a database loaded
 * yet: whatever loads during the run is the run's own doing. A reset alone
 * keeps a mock built by an earlier test, so each mock is registered again,
 * and builds anew on its next import.
 */
async function freshCommand() {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => mocks.authModule());
  vi.doMock("@/services/login-service", () => mocks.loginServiceModule());
  mocks.loaded.auth = false;
  mocks.loaded.loginService = false;
  return (await import("./create-coach")).createCoach;
}

describe("createCoach: the command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.createCoachLogin.mockResolvedValue("user-1");
    mocks.backgroundWorkSettled.mockResolvedValue(undefined);
    mocks.endPool.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses production's ref against DEV's env before anything that reaches a database loads", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    const createCoach = await freshCommand();
    await expect(createCoach(flagsFor(PROD_REF), () => envOf(DEV_REF))).rejects.toThrow(`Refused: this run is for project ${PROD_REF}`);
    expect(mocks.loaded).toEqual({ auth: false, loginService: false });
    expect(mocks.createCoachLogin).not.toHaveBeenCalled();
  });

  it("refuses a run for production whose link would open this machine, before anything loads", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const createCoach = await freshCommand();
    await expect(createCoach(flagsFor(PROD_REF), () => envOf(PROD_REF))).rejects.toThrow(`Refused: a coach on ${PROD_REF} is emailed a link`);
    expect(mocks.loaded).toEqual({ auth: false, loginService: false });
    expect(mocks.createCoachLogin).not.toHaveBeenCalled();
  });

  it("on DEV: makes the coach, waits for the email's send before the pool ends, and says where the link lands", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const createCoach = await freshCommand();
    await createCoach(flagsFor(DEV_REF), () => envOf(DEV_REF));
    expect(mocks.createCoachLogin).toHaveBeenCalledWith({ email: ADDRESS, name: "New Coach" });
    expect(mocks.backgroundWorkSettled.mock.invocationCallOrder[0]).toBeLessThan(mocks.endPool.mock.invocationCallOrder[0]);
    expect(vi.mocked(console.info).mock.calls.map(([line]) => line)).toEqual([
      `Created ${ADDRESS} (user id user-1).`,
      `Set-your-password email sent to ${ADDRESS}. Its link lasts one hour and lands on http://localhost:3000/set-password.`,
      `If it doesn't arrive: npm run auth:last-link -- --email ${ADDRESS}`,
    ]);
  });

  it("for production on its https address: made, and the coach is pointed to Forgot your password, auth:last-link being DEV's", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
    const createCoach = await freshCommand();
    await createCoach(flagsFor(PROD_REF), () => envOf(PROD_REF));
    expect(vi.mocked(console.info)).toHaveBeenLastCalledWith(`If it doesn't arrive, the coach can click "Forgot your password?" on the sign-in page.`);
  });

  it("an address that already has a login is refused with nothing written, and the pool still ends", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    mocks.createCoachLogin.mockRejectedValue(new APIError("BAD_REQUEST", { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }));
    const createCoach = await freshCommand();
    await expect(createCoach(flagsFor(DEV_REF), () => envOf(DEV_REF))).rejects.toThrow(`Refused: ${ADDRESS} already has a login. Nothing was written.`);
    expect(mocks.endPool).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();
  });
});
