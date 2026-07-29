import { supabaseAdmin } from "./supabase-admin";
import type { Client } from "@/types/check-in";
import type {
  CreateClientInput,
  UpdateClientInput,
  UpdateCheckInConfigInput,
  UpdateSettingsInput,
} from "@/lib/validations/client";
import type { ClientRow } from "@/lib/database-helpers";
import { mapClientRow } from "@/lib/mappers";
import { createIntake } from "@/services/client-intake-service";
import { sendInvitation } from "@/services/invitation-service";
import { invalidateClientAuthCache } from "@/lib/auth-cache";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { updateGoals } from "@/services/client-goals-service";

// Extended client type with check-in info
export type ClientWithCheckInInfo = Client & {
  lastCheckInDate?: string;
  engagement?: "high" | "medium" | "low";
};

// Helper function to calculate engagement level from last check-in date
const calculateEngagement = (lastCheckInDate: string | null): "high" | "medium" | "low" => {
  if (!lastCheckInDate) return "low";

  const now = new Date();
  const lastCheckIn = new Date(lastCheckInDate);
  const daysSinceLastCheckIn = Math.floor((now.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceLastCheckIn < 7) return "high";
  if (daysSinceLastCheckIn < 14) return "medium";
  return "low";
};


// Create a new client
export const createClient = async (
  coachId: string,
  clientData: CreateClientInput
): Promise<Client & { inviteSent?: boolean }> => {
  const isIntakeMode = clientData.setupMode === "intake";

  const baseInsert = {
    coach_id: coachId,
    name: clientData.name,
    email: clientData.email,
    notes: clientData.notes ?? null,
    height: clientData.height ?? null,
    height_unit: clientData.heightUnit ?? (isIntakeMode ? null : "in"),
    gender: clientData.gender ?? null,
    // goal_weight / goal_body_fat_percentage are NOT set here — `updateGoals`
    // below is the single writer of both stores (see its comment).
    weight_unit: clientData.weightUnit ?? (isIntakeMode ? null : "lbs"),
    current_weight: clientData.currentWeight ?? null,
    current_body_fat_percentage: clientData.currentBodyFatPercentage ?? null,
    starting_weight: clientData.currentWeight ?? null,
    starting_body_fat_percentage: clientData.currentBodyFatPercentage ?? null,
    active: true,
  };

  // onboarding_status is not in generated types yet, so spread it in
  const insertData = isIntakeMode
    ? { ...baseInsert, onboarding_status: "pending_intake" as const }
    : { ...baseInsert, onboarding_status: "setup_in_progress" as const };

  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert(insertData as never)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A client with this email already exists");
    }
    console.error("Failed to create client:", error);
    throw new Error("Failed to create client");
  }

  const client = mapClientRow(data);

  // Dual-write body metrics for new client (non-blocking)
  if (clientData.currentWeight !== undefined || clientData.currentBodyFatPercentage !== undefined) {
    try {
      await recordBodyMetrics({
        clientId: client.id,
        weight: clientData.currentWeight,
        bodyFatPercentage: clientData.currentBodyFatPercentage,
        source: "intake_sync",
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Goals are written ONCE, by `updateGoals`, which writes `client_goals` and
  // the `clients.*` mirror in one transaction (migration 139). The goal columns
  // are deliberately absent from `baseInsert` above: writing them here as well
  // would reopen the window this call closes, where the mirror holds the new
  // goal and `client_goals` holds nothing.
  //
  // **This throws, and that is the fix.** It used to swallow, and a swallowed
  // failure is how a live client came to show 78 kg to the coach and 92 kg in
  // their own portal for six weeks with no error anywhere. On failure the client
  // row exists with no goal in EITHER store — consistent and re-editable —
  // rather than with two stores disagreeing.
  if (clientData.goalWeight !== undefined || clientData.goalBodyFatPercentage !== undefined) {
    await updateGoals(client.id, {
      goalWeight: clientData.goalWeight,
      goalBodyFatPercentage: clientData.goalBodyFatPercentage,
    }, coachId);
  }

  // Create intake record for questionnaire flow
  if (isIntakeMode) {
    await createIntake(client.id);

    // Auto-send invite email (non-blocking — client is already created)
    const inviteResult = await sendInvitation(client.id);
    return { ...client, inviteSent: inviteResult.success };
  }

  return client;
};

// Get all clients for a coach with last check-in info
export const getClientsForCoach = async (
  coachId: string,
  includeInactive = false
): Promise<ClientWithCheckInInfo[]> => {
  // Use a single query with relational syntax to fetch clients with their latest check-in
  // This avoids the N+1 query problem
  let query = supabaseAdmin
    .from("clients")
    .select(`
      *,
      check_ins!client_id (
        created_at,
        period_end
      )
    `)
    .eq("coach_id", coachId);

  // The roster (Clients page) passes includeInactive so its "Inactive" tab can
  // populate + offer reactivation; check-in-tracking and reminders keep the
  // active-only default (you don't track or remind a deactivated client).
  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data: clients, error: clientsError } = await query.order("created_at", {
    ascending: false,
  });

  if (clientsError) {
    console.error("Failed to fetch clients:", clientsError);
    throw new Error("Failed to fetch clients");
  }

  if (!clients || clients.length === 0) {
    return [];
  }

  type ClientWithCheckIns = ClientRow & { check_ins: { created_at: string; period_end: string | null }[] };

  // Transform clients with check-in info
  return (clients as ClientWithCheckIns[]).map((client) => {
    // Get the most recent check-in date
    const checkIns = client.check_ins || [];
    const sortedCheckIns = checkIns.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const lastCheckInDate = sortedCheckIns[0]?.created_at;
    const lastCheckInPeriodEnd = sortedCheckIns[0]?.period_end ?? undefined;

    return {
      ...mapClientRow(client),
      lastCheckInDate: lastCheckInDate ?? undefined,
      lastCheckInPeriodEnd,
      engagement: calculateEngagement(lastCheckInDate ?? null),
    };
  });
};

// Get a single client by ID
export const getClientById = async (clientId: string, includeInactive = false): Promise<Client | null> => {
  let query = supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId);

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query.single();

  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("Failed to fetch client:", error);
    throw new Error("Failed to fetch client");
  }

  if (!data) return null;

  return mapClientRow(data);
};

// Update a client
export const updateClient = async (
  clientId: string,
  clientData: UpdateClientInput,
  coachId?: string
): Promise<Client> => {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (clientData.name !== undefined) updateData.name = clientData.name;
  if (clientData.email !== undefined) updateData.email = clientData.email;
  if (clientData.notes !== undefined) updateData.notes = clientData.notes ?? null;
  if (clientData.active !== undefined) updateData.active = clientData.active;
  if (clientData.height !== undefined) updateData.height = clientData.height ?? null;
  if (clientData.heightUnit !== undefined) updateData.height_unit = clientData.heightUnit;
  if (clientData.gender !== undefined) updateData.gender = clientData.gender ?? null;
  if (clientData.phone !== undefined) updateData.phone = clientData.phone || null;
  if (clientData.startDate !== undefined) updateData.start_date = clientData.startDate ?? null;
  // goal_weight / goal_body_fat_percentage are deliberately NOT in updateData —
  // `updateGoals` below owns both stores in one transaction. See its comment.
  if (clientData.weightUnit !== undefined) updateData.weight_unit = clientData.weightUnit;
  if (clientData.currentWeight !== undefined) updateData.current_weight = clientData.currentWeight ?? null;
  if (clientData.currentBodyFatPercentage !== undefined) updateData.current_body_fat_percentage = clientData.currentBodyFatPercentage ?? null;

  const { data, error } = await supabaseAdmin
    .from("clients")
    .update(updateData)
    .eq("id", clientId)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A client with this email already exists");
    }
    console.error("Failed to update client:", error);
    throw new Error("Failed to update client");
  }

  const client = mapClientRow(data);

  // If this update deactivated the client, bust its cached auth mapping too
  // (the PATCH /api/clients/[id] active:false path, distinct from deleteClient).
  if (clientData.active === false && data.user_id) {
    await invalidateClientAuthCache(data.user_id);
  }

  // Dual-write body metrics (non-blocking)
  if (clientData.currentWeight !== undefined || clientData.currentBodyFatPercentage !== undefined) {
    try {
      await recordBodyMetrics({
        clientId,
        weight: clientData.currentWeight,
        bodyFatPercentage: clientData.currentBodyFatPercentage,
        source: "metrics_api",
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Goals are written ONCE, by `updateGoals`, which writes `client_goals` and
  // the `clients.*` mirror in one transaction (migration 139). Writing the mirror
  // here too — as this function used to, before swallowing the failure — is what
  // let the two stores disagree: the mirror took the new goal, `client_goals`
  // kept the old one, and the request returned 200.
  //
  // **This throws.** A goal edit now either lands in both stores or in neither.
  // The client's other fields are already committed above and are unaffected,
  // which is the correct split: they are independent edits that happen to travel
  // in one PATCH.
  if (clientData.goalWeight !== undefined || clientData.goalBodyFatPercentage !== undefined) {
    await updateGoals(clientId, {
      goalWeight: clientData.goalWeight,
      goalBodyFatPercentage: clientData.goalBodyFatPercentage,
    }, coachId ?? "coach");

    // `client` was mapped from the row read BEFORE the RPC moved the mirror, so
    // without this the response would echo the previous goal back to the caller
    // and the UI would render a successful save as a no-op.
    if (clientData.goalWeight !== undefined) {
      client.goalWeight = clientData.goalWeight ?? undefined;
    }
    if (clientData.goalBodyFatPercentage !== undefined) {
      client.goalBodyFatPercentage = clientData.goalBodyFatPercentage ?? undefined;
    }
  }

  return client;
};

// Delete a client (soft delete - set active to false)
export const deleteClient = async (clientId: string): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    console.error("Failed to delete client:", error);
    throw new Error("Failed to delete client");
  }

  // Revoke the deactivated client's cached auth mapping so it cannot keep
  // resolving for up to the cache TTL. user_id may be null (client never
  // accepted an invite) — nothing to bust in that case.
  if (data?.user_id) {
    await invalidateClientAuthCache(data.user_id);
  }
};

// Reactivate a soft-deleted client (undo deleteClient). Sets active back to true
// and busts the auth cache so the client can log in again immediately rather
// than after the 60s TTL (the loaders filter active=true — H6).
export const reactivateClient = async (clientId: string): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .update({
      active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    console.error("Failed to reactivate client:", error);
    throw new Error("Failed to reactivate client");
  }

  if (data?.user_id) {
    await invalidateClientAuthCache(data.user_id);
  }
};

// Permanently delete a client (use with caution)
export const permanentlyDeleteClient = async (clientId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("clients")
    .delete()
    .eq("id", clientId);

  if (error) {
    console.error("Failed to permanently delete client:", error);
    throw new Error("Failed to permanently delete client");
  }
};

// Update client-controlled settings (PATCH /api/client/settings)
// Writes only the fields supplied. weight_unit is derived from unit_preference
// in the same UPDATE so the two columns stay in sync.
export const updateClientSettings = async (
  clientId: string,
  settings: UpdateSettingsInput
): Promise<Client> => {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (settings.unitPreference !== undefined) {
    updateData.unit_preference = settings.unitPreference;
    updateData.weight_unit = settings.unitPreference === "metric" ? "kg" : "lbs";
  }

  if (settings.timezone !== undefined) {
    updateData.timezone = settings.timezone;
  }

  const { data, error } = await supabaseAdmin
    .from("clients")
    .update(updateData)
    .eq("id", clientId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update client settings:", error);
    throw new Error("Failed to update client settings");
  }

  return mapClientRow(data);
};

// Update client check-in configuration
export const updateClientCheckInConfig = async (
  clientId: string,
  config: UpdateCheckInConfigInput
): Promise<Client> => {
  const updateData: Record<string, unknown> = {
    check_in_frequency: config.checkInFrequency,
    check_in_frequency_days: config.checkInFrequencyDays ?? null,
    expected_check_in_day: config.expectedCheckInDay ?? null,
    reminder_preferences: config.reminderPreferences,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("clients")
    .update(updateData)
    .eq("id", clientId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update check-in config:", error);
    throw new Error("Failed to update check-in config");
  }

  return mapClientRow(data);
};
