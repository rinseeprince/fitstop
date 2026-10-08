/**
 * The project's public key (Supabase's anon key), for the proofs that knock on
 * the Data API's side door with it. The app holds it no more (D29): every
 * read goes through the server and the browser carries no Supabase client.
 * But every browser bundle carried it until Better Auth, so anyone may hold it
 * still, and the lock of migration 201 is what refuses it.
 *
 * Read from the project's API keys through the Supabase CLI's own login, for
 * the project NEXT_PUBLIC_SUPABASE_URL names: the one the proofs send to.
 */
import { execFileSync } from "node:child_process";

type ApiKey = { name: string; api_key: string };

export function dataApiPublicKey(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  const ref = new URL(url).hostname.split(".")[0];
  const out = execFileSync("npx", ["supabase", "projects", "api-keys", "--project-ref", ref, "--output-format", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keys = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)) as ApiKey[];
  const anon = keys.find((key) => key.name === "anon")?.api_key;
  if (!anon) throw new Error(`The project ${ref} lists no anon key`);
  return anon;
}
