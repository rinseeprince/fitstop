import { supabaseAdmin } from "@/services/supabase-admin";

/**
 * What the app's rows do when a login changes (docs/BETTER-AUTH-PLAN.md 2.2):
 * the reads and writes Better Auth's hooks in lib/auth.ts make on the app's
 * tables, through supabaseAdmin, keyed on the login's id.
 */

/**
 * Whether the login is a coach's: the role the path that made it set (D9),
 * read from profiles as the proxy reads it. Throws when the role cannot be
 * read, so a fault refuses rather than guesses.
 */
export async function isCoachLogin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the login's role: ${error.message}`);
  return data?.role === "trainer";
}

/**
 * A coach's email follows their login's address (D18): the coach row's
 * `email` is a copy of it, written at birth by createCoachLogin and here
 * after Better Auth updates the login, the second link of a change of email
 * being what changes the address. One statement, a no-op when the row
 * already says it or when the login is a client's (no coach row). Throws
 * when the write fails.
 */
export async function mirrorEmailToCoachRow(user: { id: string; email: string }): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coaches")
    .update({ email: user.email })
    .eq("user_id", user.id)
    .neq("email", user.email);
  if (error) throw new Error(`Failed to copy the login's email to the coach row: ${error.message}`);
}
