import { supabaseAdmin } from "@/services/supabase-admin";
import { toProfile, type Profile, type UserRole } from "@/types/auth";
import type { Coach } from "@/types/check-in";
import type { CoachRow } from "@/lib/database-helpers";
import { mapCoachRow } from "@/lib/mappers";

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
 * A signed-in user's profile, and the coach row for a trainer: a pure read.
 * The paths that make a login write both in the same request
 * (services/login-service.ts), so a login without its rows is a fault, not a
 * gap to fill here: it throws, and nothing is made on read.
 *
 * Invariant: on success, `role === "trainer"` ⟺ `coach` is present;
 * `coach: null` is exclusively the client shape.
 */
export async function getProfileAndCoach(
  userId: string
): Promise<{ profile: Profile; coach: Coach | null }> {
  const profileRow = await readProfileRow(userId);
  if (!profileRow) {
    console.error("No profile for a signed-in login:", userId);
    throw new Error("Failed to load profile");
  }

  // role is CHECK-constrained to trainer|client in the DB; the generated type
  // is a bare string.
  const profile = toProfile({ ...profileRow, role: profileRow.role as UserRole });

  if (profile.role !== "trainer") {
    return { profile, coach: null };
  }

  const coachRow = await readCoachRow(userId);
  if (!coachRow) {
    console.error("No coach row for a signed-in trainer:", userId);
    throw new Error("Failed to load coach profile");
  }

  return { profile, coach: mapCoachRow(coachRow) };
}
