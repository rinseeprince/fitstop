/**
 * The removability marker.
 *
 * There is no `seed_batch_id` column on any of the 40 public tables, and adding
 * one would be a schema change. Instead every seeded row gets an explicitly
 * supplied primary key inside a reserved UUID namespace:
 *
 *     5eed0001-xxxx-4xxx-8xxx-xxxxxxxxxxxx
 *     ^^^^^^^^ fixed 4-byte prefix
 *
 * Two properties make this the right marker:
 *
 *  1. **Teardown is a primary-key range scan.** uuid btrees order bytewise, so
 *     `WHERE id >= '5eed0001-0000-…' AND id < '5eed0002-0000-…'` is an index
 *     range scan on a column that is indexed by definition — no new index, no
 *     schema change, and it satisfies "delete on indexed columns only". This
 *     matters: 17 foreign keys in this schema have no supporting index, so
 *     deleting children by FK would be O(n²).
 *  2. **Nothing outside the namespace can be touched.** Teardown never issues a
 *     predicate that could match a real row, and asserts the unmarked row count
 *     per table is unchanged before/after.
 *
 * 39 of the 40 tables have PK `id uuid` and there are zero identity/serial
 * columns, so this works universally. `coach_client_views` is the exception —
 * composite PK `(coach_id, client_id)` — but its leading column is a seeded
 * coach UUID, so a PK range scan still applies.
 */

/** The reserved 4-byte prefix. Bump only if a previous namespace must coexist. */
export const SEED_PREFIX = "5eed0001";

/** Inclusive lower / exclusive upper bound of the namespace, for range scans. */
export const SEED_ID_LO = `${SEED_PREFIX}-0000-0000-0000-000000000000`;
export const SEED_ID_HI = "5eed0002-0000-0000-0000-000000000000";

/** Email domain marker for the auth users the seed creates. */
export const SEED_EMAIL_DOMAIN = "seed.atletafit.test";

const HEX = "0123456789abcdef";

/**
 * Deterministic, namespaced UUID v4-shaped id.
 *
 * The 12 bytes after the prefix are derived from the parts, so the same logical
 * row always gets the same id across runs — which is what makes the seed
 * resumable and lets a manifest be compared between runs. Version (4) and
 * variant (8) nibbles are forced so the value is a well-formed UUID and
 * Postgres' uuid type accepts it.
 */
export function seedUuid(...parts: (string | number)[]): string {
  // Two independent xorshift streams, so 12 bytes of output are not just a
  // 32-bit value repeated. Seeded by FNV-1a over the parts.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 0x85ebca6b);
  }
  h1 = (h1 >>> 0) || 0x9e3779b9;
  h2 = (h2 >>> 0) || 0x7f4a7c15;

  const nibble = (): string => {
    h1 ^= h1 << 13; h1 >>>= 0;
    h1 ^= h1 >>> 17;
    h1 ^= h1 << 5;  h1 >>>= 0;
    h2 ^= h2 << 7;  h2 >>>= 0;
    h2 ^= h2 >>> 9;
    return HEX[(h1 ^ h2) & 0xf];
  };

  const take = (n: number): string => Array.from({ length: n }, nibble).join("");

  // 5eed0001-XXXX-4XXX-8XXX-XXXXXXXXXXXX
  return `${SEED_PREFIX}-${take(4)}-4${take(3)}-8${take(3)}-${take(12)}`;
}

/** True if the id belongs to the seed namespace. */
export function isSeedId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.toLowerCase().startsWith(`${SEED_PREFIX}-`);
}

/** The email a seeded principal logs in with. Stable per index. */
export function seedEmail(kind: "coach" | "client", index: number): string {
  return `${kind}${String(index).padStart(3, "0")}@${SEED_EMAIL_DOMAIN}`;
}

/** True if an auth user belongs to the seed. Used by teardown. */
export function isSeedEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${SEED_EMAIL_DOMAIN}`);
}
