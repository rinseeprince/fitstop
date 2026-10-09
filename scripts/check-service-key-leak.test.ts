// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CONTROL_VAR, databasePasswordForms, otherSecretNeedles, scanBundle } from "./check-service-key-leak"

/**
 * The bundle clause's search for lib/auth.ts's secrets, against a bundle made
 * here with made-up values: a real secret is never written to disk.
 */
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXNlZ21lbnQtb2YtdGhlLWtleQ"
const CONTROL = "public-anon-control-value"
const DATABASE_PASSWORD = "made-up-database-password-1234"
/** A password that needs encoding, as a pooler string writes it and decoded. */
const ENCODED = "made-up%40database%23password"
const DECODED = "made-up@database#password"
const AUTH_SECRET = "made-up-better-auth-secret-5678"
const GOOGLE_SECRET = "made-up-google-client-secret-9012"
const pooler = (password: string) => `postgresql://postgres.ref:${password}@host.pooler.supabase.com:6543/postgres`

const dirs: string[] = []
function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "leak-gate-"))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const secrets = [
  { label: "database password", value: DATABASE_PASSWORD },
  { label: "BETTER_AUTH_SECRET value", value: AUTH_SECRET },
  { label: "GOOGLE_CLIENT_SECRET value", value: GOOGLE_SECRET },
]

describe("the bundle scan for lib/auth.ts's secrets", () => {
  it("finds the database password, Better Auth's secret and the Google client secret wherever a chunk carries them", () => {
    const dir = bundle({
      "page.js": `const anon = "${CONTROL}"`,
      "leaky.js": `fetch("${DATABASE_PASSWORD}"); const s = "${AUTH_SECRET}"`,
      "google.js": `const g = { secret: "${GOOGLE_SECRET}" }`,
    })
    const scan = scanBundle(dir, "production", SERVICE_KEY, CONTROL, secrets)
    expect(scan.secretHits.map(({ label, hits }) => [label, hits.length])).toEqual([
      ["database password", 1],
      ["BETTER_AUTH_SECRET value", 1],
      ["GOOGLE_CLIENT_SECRET value", 1],
    ])
    expect(scan.secretHits[2].hits[0]).toMatch(/google\.js$/)
    expect(scan.secretHits[0].hits[0]).toMatch(/leaky\.js$/)
  })

  it("finds nothing in a clean bundle, which still carries its control", () => {
    const dir = bundle({ "page.js": `const anon = "${CONTROL}"` })
    const scan = scanBundle(dir, "production", SERVICE_KEY, CONTROL, secrets)
    expect(scan.controlHits).toHaveLength(1)
    expect(scan.secretHits.every(({ hits }) => hits.length === 0)).toBe(true)
  })
})

describe("the database password the scan looks for", () => {
  it("is read out of the pooler string as the string writes it, percent-encoded, and decoded", () => {
    expect(databasePasswordForms(pooler(ENCODED))).toEqual([ENCODED, DECODED])
  })

  it("is one form when the password needs no encoding", () => {
    expect(databasePasswordForms(pooler(DATABASE_PASSWORD))).toEqual([DATABASE_PASSWORD])
  })

  it("has no form when the string holds none, is not a URL, or escapes it badly", () => {
    expect(databasePasswordForms("postgresql://postgres.ref@host:6543/postgres")).toEqual([])
    expect(databasePasswordForms("not a url")).toEqual([])
    expect(databasePasswordForms(pooler("bad-escape-%E0%A4%A-in-password"))).toEqual([])
  })

  it("is found as an inlined DATABASE_URL carries it, where its decoded form never appears", () => {
    const dir = bundle({ "page.js": `const anon = "${CONTROL}"`, "leaky.js": `const url = "${pooler(ENCODED)}"` })
    const { needles } = otherSecretNeedles(pooler(ENCODED), AUTH_SECRET, GOOGLE_SECRET)
    const scan = scanBundle(dir, "production", SERVICE_KEY, CONTROL, needles)
    expect(scan.secretHits.map(({ label, hits }) => [label, hits.length])).toEqual([
      ["database password", 1],
      ["database password, decoded", 0],
      ["BETTER_AUTH_SECRET value", 0],
      ["GOOGLE_CLIENT_SECRET value", 0],
    ])
  })
})

describe("the secrets the gate cannot search for (INCONCLUSIVE, never a pass)", () => {
  it("is none when every form of each is long enough", () => {
    expect(otherSecretNeedles(pooler(ENCODED), AUTH_SECRET, GOOGLE_SECRET).unscannable).toEqual([])
  })

  it("names a DATABASE_URL that is missing or holds no password, and a missing secret", () => {
    expect(otherSecretNeedles(null, null, null).unscannable).toEqual(["database password", "BETTER_AUTH_SECRET value", "GOOGLE_CLIENT_SECRET value"])
    expect(otherSecretNeedles("postgresql://postgres.ref@host:6543/postgres", AUTH_SECRET, GOOGLE_SECRET).unscannable).toEqual(["database password"])
    expect(otherSecretNeedles(pooler(ENCODED), AUTH_SECRET, null).unscannable).toEqual(["GOOGLE_CLIENT_SECRET value"])
  })

  it("names each form too short to mean anything, the decoded one included", () => {
    // 16 characters as written, 8 decoded.
    expect(otherSecretNeedles(pooler("ab%40%40%40%40cd"), AUTH_SECRET, GOOGLE_SECRET).unscannable).toEqual(["database password, decoded"])
  })
})

describe("the bundle clause's positive control (D35)", () => {
  it("is the Sentry DSN, the public value the browser's own Sentry init inlines into every bundle", () => {
    expect(CONTROL_VAR).toBe("NEXT_PUBLIC_SENTRY_DSN")
    const browserInit = readFileSync(join(__dirname, "..", "instrumentation-client.ts"), "utf8")
    expect(browserInit).toContain(`process.env.${CONTROL_VAR}`)
  })

  it("is no Supabase key: the browser holds no Supabase client", () => {
    const gate = readFileSync(join(__dirname, "check-service-key-leak.ts"), "utf8")
    expect(gate).not.toMatch(/readEnvVar\(\s*["']NEXT_PUBLIC_SUPABASE/)
  })
})
