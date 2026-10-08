import type { ConnectionOptions } from "node:tls"

/**
 * Supabase's root certificate authority, "Supabase Root 2021 CA" (valid to
 * 2031-04-26; SHA-256 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA).
 *
 * Supabase's Postgres endpoints, its pooler included, present a chain that
 * ends here, and Node's own CA store does not hold it: without this root a
 * verified connection fails, and an unverified one sends the logins' password
 * hashes and session tokens to whoever answers. This is the certificate the
 * dashboard's "Download certificate" serves (prod-ca-2021.crt), byte for byte
 * the root DEV's pooler presented on 2026-10-08. It is public; nothing here is
 * a secret.
 */
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`

/**
 * DATABASE_URL as a URL. A string that does not parse is refused with an
 * error that never carries it: the one Node throws holds the whole string,
 * password and all, and would put it in the server's log.
 */
export function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl)
  } catch {
    throw new Error("DATABASE_URL is not a URL: percent-encode any @ # / ? : or % in its password.")
  }
}

/**
 * A pg connection to Supabase's Postgres for DATABASE_URL, the pooler string
 * as the dashboard gives it, its TLS verified against Supabase's root. Better
 * Auth's pool (lib/auth.ts) and the scripts beside it connect through this.
 * pg lets a parameter in the string replace the TLS setting it is given, so a
 * stray sslmode=disable would send password hashes in the clear: a string
 * carrying any parameter is refused.
 */
export function supabaseConnection(databaseUrl: string): { connectionString: string; ssl: ConnectionOptions } {
  if (parseDatabaseUrl(databaseUrl).search !== "") {
    throw new Error("DATABASE_URL must be the pooler string with no parameters: lib/supabase-connection.ts sets the connection's TLS itself.")
  }
  return { connectionString: databaseUrl, ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } }
}
