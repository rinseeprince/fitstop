import { supabaseAdmin } from "@/services/supabase-admin";
import { toProfile, type Profile, type UserRole } from "@/types/auth";
import type { Coach } from "@/types/check-in";
import type { CoachRow } from "@/lib/database-helpers";
import { mapCoachRow } from "@/lib/mappers";

/**
 * Minimal identity shape for profile/coach bootstrap — a structural subset of
 * supabase-js `User`, so routes can pass the authenticated user straight
 * through. Role is NEVER read from `user_metadata`: it is derived from server
 * state, mirroring the `handle_new_user` trigger (migration 107).
 */
export type AuthUserIdentity = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

async function readProfileRow(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to read profile:", error);
    throw new Error("Failed to load profile");
  }
  return data;
}

async function readCoachRow(userId: string): Promise<CoachRow | null> {
  const { data, error } = await supabaseAdmin
    .from("coaches")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to read coach profile:", error);
    throw new Error("Failed to load coach profile");
  }
  return data;
}

/**
 * Mirror of the trigger's role derivation: an existing `client_invitations`
 * row matching the email case-insensitively means this user was invited as a
 * client; anyone else is a trainer self-signup. Bare existence check — no
 * status filter, exactly like the trigger.
 */
async function deriveRole(email: string): Promise<UserRole> {
  // Escape LIKE wildcards so .ilike() is a case-insensitive equality match,
  // equivalent to the trigger's lower() = lower() comparison.
  const pattern = email.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await supabaseAdmin
    .from("client_invitations")
    .select("id")
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to derive role from invitations:", error);
    throw new Error("Failed to derive user role");
  }
  return data ? "client" : "trainer";
}

/**
 * Fetch the user's profile (and coach row for trainers), creating them
 * idempotently when missing. The signup trigger (migration 107) creates both
 * rows at auth.users INSERT; this covers pre-trigger users and the narrow
 * window where a fresh signup's first request beats the trigger's row. Both
 * create paths use ON CONFLICT (user_id) DO NOTHING semantics, so the trigger
 * (or a concurrent request) winning the race is a silent no-op and the re-read
 * returns the winner's row.
 *
 * Invariant: on success, `role === "trainer"` ⟺ `coach` is present;
 * `coach: null` is exclusively the client shape.
 */
export async function getOrCreateProfileAndCoach(
  user: AuthUserIdentity
): Promise<{ profile: Profile; coach: Coach | null }> {
  let profileRow = await readProfileRow(user.id);

  if (!profileRow) {
    // Every signup flow is email-based; a user without an email cannot have
    // an invitation-derived role or a coaches row (email is NOT NULL there).
    if (!user.email) {
      console.error("Cannot bootstrap profile for user without email:", user.id);
      throw new Error("Failed to load profile");
    }
    const role = await deriveRole(user.email);
    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { user_id: user.id, role },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    if (error) {
      console.error("Failed to create profile:", error);
      throw new Error("Failed to create profile");
    }
    profileRow = await readProfileRow(user.id);
    if (!profileRow) {
      console.error("Profile missing after idempotent create:", user.id);
      throw new Error("Failed to load profile");
    }
  }

  // role is CHECK-constrained to trainer|client in the DB; the generated type
  // is a bare string.
  const profile = toProfile({ ...profileRow, role: profileRow.role as UserRole });

  if (profile.role !== "trainer") {
    return { profile, coach: null };
  }

  let coachRow = await readCoachRow(user.id);

  if (!coachRow) {
    if (!user.email) {
      console.error("Cannot bootstrap coach row for user without email:", user.id);
      throw new Error("Failed to load coach profile");
    }
    const meta = user.user_metadata ?? {};
    // ?? (not ||) mirrors the trigger's COALESCE: '' counts as a value in SQL.
    const name =
      (meta.name as string | undefined) ??
      (meta.full_name as string | undefined) ??
      user.email.split("@")[0];
    const { error } = await supabaseAdmin
      .from("coaches")
      .upsert(
        {
          user_id: user.id,
          name,
          email: user.email,
          avatar_url: (meta.avatar_url as string | undefined) ?? null,
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    if (error) {
      // Includes the coaches_email_key collision (same email owned by another
      // user_id) — unreachable via legitimate flows; fail loudly rather than
      // return a trainer with no coach row (every coach route rejects that).
      console.error("Failed to create coach profile:", error);
      throw new Error("Failed to create coach profile");
    }
    coachRow = await readCoachRow(user.id);
    if (!coachRow) {
      console.error("Coach row missing after idempotent create:", user.id);
      throw new Error("Failed to load coach profile");
    }
  }

  return { profile, coach: mapCoachRow(coachRow) };
}
