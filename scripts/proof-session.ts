/**
 * A real session for the request-level proof scripts, minted with no browser:
 * `generateLink` (sends no email) → `verifyOtp` → the @supabase/ssr cookie jar,
 * whose cookies become the Cookie header the app's auth helpers read. Plus the
 * two request helpers every proof uses against a running `next dev`.
 *
 * A vitest that mocks `supabaseAdmin` proves nothing about a route's chain or a
 * wire; these scripts drive the real thing against the linked DEV project.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const PROOF_BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";

/** `cookie` drives the app; `accessToken` goes straight to the Data API, as a browser holding the login could. */
export type ProofSession = { label: string; cookie: string; accessToken: string };

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

export async function mintSession(email: string, label: string): Promise<ProofSession> {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const admin = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.email_otp) {
    throw new Error(`generateLink failed for ${email}: ${linkError?.message ?? "no otp"}`);
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError || !verified.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyError?.message ?? "no session"}`);
  }

  const jar = new Map<string, string>();
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error: setError } = await ssr.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (setError) throw new Error(`setSession failed for ${email}: ${setError.message}`);
  if (jar.size === 0) throw new Error(`No auth cookie minted for ${email}`);

  return {
    label,
    cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    accessToken: verified.session.access_token,
  };
}

export type ProofResponse = { status: number; text: string; json: unknown };

/** One request as the session, with the Origin the CSRF check reads. */
export async function send(
  session: ProofSession,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<ProofResponse> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    method,
    headers: {
      Cookie: session.cookie,
      Origin: PROOF_BASE,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}
