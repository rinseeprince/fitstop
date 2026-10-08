// @vitest-environment node
import { X509Certificate } from "node:crypto"
import { describe, it, expect } from "vitest"
import { SUPABASE_ROOT_CA, supabaseConnection } from "./supabase-connection"

/**
 * The connection Better Auth and the scripts beside it make to Supabase's
 * Postgres: TLS verified against Supabase's own root, and no string that
 * could replace that setting.
 */
const POOLER = "postgresql://postgres.test:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

describe("Supabase's root certificate", () => {
  it("is Supabase Root 2021 CA, the root the pooler presents, valid to 2031", () => {
    const root = new X509Certificate(SUPABASE_ROOT_CA)
    expect(root.subject).toContain("CN=Supabase Root 2021 CA")
    expect(root.issuer).toBe(root.subject)
    expect(root.ca).toBe(true)
    expect(root.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
    )
    expect(new Date(root.validTo).toISOString().slice(0, 10)).toBe("2031-04-26")
  })
})

describe("a connection to Supabase's Postgres", () => {
  it("verifies the server against Supabase's root, and only that root", () => {
    expect(supabaseConnection(POOLER)).toEqual({
      connectionString: POOLER,
      ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    })
  })

  it.each(["?sslmode=disable", "?sslmode=no-verify", "?sslmode=require", "?ssl=false", "?application_name=x"])(
    "refuses a string carrying %s, which pg would let replace that setting",
    (parameter) => {
      expect(() => supabaseConnection(`${POOLER}${parameter}`)).toThrow("DATABASE_URL must be the pooler string with no parameters")
    }
  )

  it("refuses a string that is not a URL, and the refusal never carries the password", () => {
    const broken = "postgresql://postgres.test:pa#ss-word-1234@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"
    let thrown: unknown
    try {
      supabaseConnection(broken)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe("DATABASE_URL is not a URL: percent-encode any @ # / ? : or % in its password.")
    const everything = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown)) + String((thrown as Error).stack)
    expect(everything).not.toContain("pa#ss")
    expect((thrown as Error).cause).toBeUndefined()
  })
})
