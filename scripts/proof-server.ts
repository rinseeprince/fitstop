/**
 * The next dev a request-level proof runs against: its own, started on a free
 * port, never :3000, which belongs to whoever runs a dev server there. Better
 * Auth's base URL and the app URL name that port, so the session cookie, the
 * CSRF check and Better Auth's origin check all read one origin. No email the
 * server sends leaves the machine: Resend points at a closed port, or at the
 * proof's own mailbox (scripts/proof-mailbox.ts) when the proof reads its
 * emails. It reports nothing to Sentry. It prints every database call it makes
 * (PERF_COUNT=1, lib/perf/db-calls.ts), which a proof and scripts/perf-count.ts
 * read in `output`. It runs in its own process group, so stopping it stops
 * nothing else, and any exit of the script stops it, an interrupt included.
 *
 * next dev holds a lock on this folder: one proof at a time, and none while
 * another next dev runs here.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { parseDbCallLine } from "@/lib/perf/db-calls";
import { setProofBase } from "./proof-session";

const ROOT = join(__dirname, "..");
/** Discard: a connection here is refused at once, so no email leaves the machine. */
export const NO_EMAIL = "http://127.0.0.1:9";
const OWNERS_PORT = 3000;
const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;
/** The server is quiet once no [db] line has come for this long: three of its own 300 ms burst gaps, and the pipe's delay. */
const QUIET_MS = 1_000;
/** How long a request may keep the server printing before the run gives up. */
const SETTLE_TIMEOUT_MS = 60_000;
const POLL_MS = 50;

/** The running server: its address, and everything it has printed (the evidence when a proof fails). */
export type ProofServer = { base: string; output: string[] };

/**
 * The server's output as whole lines, read on as it prints: what a script
 * reads its [db] lines from (scripts/perf-count.ts, scripts/auth-latency-probe.ts).
 */
export class ServerLines {
  readonly lines: string[] = [];
  private chunksRead = 0;
  private partial = "";
  constructor(private readonly output: string[]) {}

  pull(): void {
    while (this.chunksRead < this.output.length) {
      const parts = (this.partial + this.output[this.chunksRead]).split("\n");
      this.chunksRead += 1;
      this.partial = parts.pop() ?? "";
      this.lines.push(...parts);
    }
  }

  /** Resolves once no [db] line has arrived for QUIET_MS. */
  async settle(): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const before = this.lines.length;
      this.pull();
      if (this.lines.slice(before).some((line) => parseDbCallLine(line))) quietSince = Date.now();
      if (Date.now() - quietSince >= QUIET_MS) return;
    }
    throw new Error(`The server was still printing database calls after ${SETTLE_TIMEOUT_MS / 1000} s`);
  }
}

let running: { child: ChildProcess; server: ProofServer } | null = null;

/** A free port that is not :3000. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 && port !== OWNERS_PORT ? resolve(port) : reject(new Error(`No usable port (${port})`))));
    });
  });
}

/**
 * Starts this run's next dev, waits until /login answers, and points the
 * request helpers (scripts/proof-session.ts) at it. Its email goes to
 * `emailTo`, a proof's mailbox on this machine, when one is given.
 */
export async function startProofServer({ emailTo = NO_EMAIL }: { emailTo?: string } = {}): Promise<ProofServer> {
  if (running) return running.server;
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const output: string[] = [];
  const child = spawn(join(ROOT, "node_modules/.bin/next"), ["dev", "--port", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      BETTER_AUTH_URL: base,
      NEXT_PUBLIC_APP_URL: base,
      RESEND_BASE_URL: emailTo,
      SENTRY_DSN: "",
      PERF_COUNT: "1",
    },
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  // The server never holds the script open: once the script's own work is
  // done it exits, whatever its cleanup reached, and the exit hook below stops
  // the server. With stdio "pipe" both streams are sockets.
  child.unref();
  (child.stdout as Socket | null)?.unref();
  (child.stderr as Socket | null)?.unref();
  running = { child, server: { base, output } };

  // Any exit that skips the script's own stop still stops the server, and so does an interrupt.
  process.on("exit", terminate);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      console.error(`Interrupted (${signal}): next dev stopped; this run's cleanup did not run.`);
      process.exit(130);
    });
  }

  const started = Date.now();
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`next dev exited before it was ready (another next dev may hold this folder):\n${output.join("").slice(-1500)}`);
    }
    try {
      const res = await fetch(`${base}/login`, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (res.status === 200) {
        console.info(`Started next dev at ${base} (pid ${child.pid})`);
        setProofBase(base);
        return running.server;
      }
    } catch {
      // Not listening yet: keep waiting until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  // A server that never got ready is stopped here, not left holding the folder's lock.
  await stopProofServer();
  throw new Error(`next dev did not answer /login within ${READY_TIMEOUT_MS / 1000} s:\n${output.join("").slice(-1500)}`);
}

/** SIGTERM to the server's process group while it still runs; synchronous, for the exit handler. */
function terminate(): void {
  const child = running?.child;
  if (child?.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    console.error(`next dev (pid ${child.pid}) had already stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Stops this run's next dev, waiting for it to exit (SIGKILL after a grace period). Never throws: it runs in finally blocks. */
export async function stopProofServer(): Promise<void> {
  const child = running?.child;
  if (child?.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    process.kill(-pid, "SIGTERM");
    const stopped = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), STOP_TIMEOUT_MS))]);
    if (!stopped && child.exitCode === null && child.signalCode === null) process.kill(-pid, "SIGKILL");
    console.info(`Stopped next dev (pid ${pid})`);
  } catch (error) {
    console.error(`next dev (pid ${pid}) had already stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
