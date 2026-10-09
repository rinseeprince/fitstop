/**
 * A stand-in for Resend on this machine, for a proof that must read what the
 * app emails: change email's two links carry a token Better Auth signs and
 * never stores (docs/BETTER-AUTH-PLAN.md section 6, commit 5), so the email is
 * the only place they exist. The proof's next dev is started with Resend
 * pointed here (startProofServer's `emailTo`), so every email the server sends
 * lands in this process and none leaves the machine. It answers as Resend's
 * API does: POST /emails, 200 with the email's id. An address the proof has it
 * refuse is answered as Resend refuses one it won't deliver to (its sandbox's
 * 403), so a proof can watch the app take a failed send (commit 10).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** One email the server sent, as Resend would have received it. */
export type MailboxEmail = { to: string[]; subject: string; text: string; html: string };

export type ProofMailbox = {
  /** What RESEND_BASE_URL is set to for the server. */
  url: string;
  /** Every email received, in order. */
  emails: MailboxEmail[];
  /** Every email refused, in order: none of them is in `emails`. */
  refused: MailboxEmail[];
  /** Refuses every email to these addresses from now on, until `accept` takes them again. */
  refuse(...addresses: string[]): void;
  accept(...addresses: string[]): void;
  /** The first email to `to` with `subject`, waiting for it to arrive; null when none comes in time. */
  waitForEmail(to: string, subject: string, timeoutMs?: number): Promise<MailboxEmail | null>;
  stop(): Promise<void>;
};

/** Resend's answer to an address its sandbox won't deliver to: the error the app must never show a coach. */
export const REFUSAL_MESSAGE =
  "You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain at resend.com/domains.";

/** Better Auth sends after its answer has gone: an email may land a moment after the request that caused it. */
const ARRIVAL_TIMEOUT_MS = 20_000;
const POLL_MS = 100;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Starts the mailbox on a free port of 127.0.0.1. */
export async function startProofMailbox(): Promise<ProofMailbox> {
  const emails: MailboxEmail[] = [];
  const refused: MailboxEmail[] = [];
  const refusing = new Set<string>();

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/emails") {
      answer(response, 404, { name: "not_found", message: `The proof's mailbox takes POST /emails alone, not ${request.method} ${request.url}` });
      return;
    }
    readBody(request)
      .then((raw) => {
        const sent = JSON.parse(raw) as { to?: string | string[]; subject?: string; text?: string; html?: string };
        const email = {
          to: (Array.isArray(sent.to) ? sent.to : [sent.to ?? ""]).map((address) => address.toLowerCase()),
          subject: sent.subject ?? "",
          text: sent.text ?? "",
          html: sent.html ?? "",
        };
        if (email.to.some((address) => refusing.has(address))) {
          refused.push(email);
          answer(response, 403, { statusCode: 403, name: "validation_error", message: REFUSAL_MESSAGE });
          return;
        }
        emails.push(email);
        answer(response, 200, { id: `proof-email-${emails.length}` });
      })
      .catch((error: unknown) => {
        answer(response, 400, { name: "validation_error", message: error instanceof Error ? error.message : String(error) });
      });
  });
  // Never what keeps the script alive: its own finally stops it, and so does its exit.
  server.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("The proof's mailbox has no port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    emails,
    refused,
    refuse: (...addresses) => addresses.forEach((address) => refusing.add(address.toLowerCase())),
    accept: (...addresses) => addresses.forEach((address) => refusing.delete(address.toLowerCase())),
    async waitForEmail(to, subject, timeoutMs = ARRIVAL_TIMEOUT_MS) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const found = emails.find((email) => email.subject === subject && email.to.includes(to.toLowerCase()));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      return null;
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
