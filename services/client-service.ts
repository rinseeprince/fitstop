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
import { recalculateClientEnergy } from "@/services/client-energy-service";
import { computeEnergyPair } from "@/services/client-energy-calc";

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

  // No conversion here. The payload is already canonical: the add-client form
  // collects in the coach's own display units and converts before submitting
  // (hooks/use-unit-inputs.ts), and the schema no longer carries a unit tag to
  // convert on.
  const currentWeightKg = clientData.currentWeight;
  const goalWeightKg = clientData.goalWeight;
  const heightCm = clientData.height;

  // The pair is set once, at row birth, through the same pure calculator the
  // single UPDATE-writer uses (services/client-energy-service.ts). Doing it in
  // the INSERT rather than as a follow-up write means it lands atomically with
  // the measurements it derives from and leaves no window where a client exists
  // with weight but no metabolism. Incomplete measurements simply leave both
  // columns NULL — never one without the other.
  const energy = computeEnergyPair({
    weightKg: currentWeightKg,
    heightCm,
    gender: clientData.gender,
    bodyFatPercentage: clientData.currentBodyFatPercentage,
    dateOfBirth: clientData.dateOfBirth,
  });

  const baseInsert = {
    coach_id: coachId,
    name: clientData.name,
    email: clientData.email,
    notes: clientData.notes ?? null,
    height: heightCm ?? null,
    gender: clientData.gender ?? null,
    // goal_weight / goal_body_fat_percentage are deliberately ABSENT.
    // `updateGoals` below is the single writer of both stores — it inserts the
    // `client_goals` row and mirrors it onto `clients` — so writing them here
    // too would reopen the window it exists to close: the mirror holding a goal
    // that `client_goals` never received.
    current_weight: currentWeightKg ?? null,
    current_body_fat_percentage: clientData.currentBodyFatPercentage ?? null,
    starting_weight: currentWeightKg ?? null,
    starting_body_fat_percentage: clientData.currentBodyFatPercentage ?? null,
    bmr: energy.status === "ready" ? energy.bmr : null,
    tdee: energy.status === "ready" ? energy.tdee : null,
    // Explicitly NULL rather than letting the column DEFAULT ('sedentary')
    // apply. The default made "never set" indistinguishable from "the coach
    // chose sedentary", which silently disabled the intake sync's
    // `work_activity_level == null` guard: a client answering "very active" on
    // their questionnaire landed as sedentary forever, and only a coach
    // noticing and fixing it by hand could correct it. NULL reads as sedentary
    // in the calculator either way (DEFAULT_WORK_ACTIVITY_LEVEL), so nothing
    // downstream changes — only the ability to tell unset from chosen.
    work_activity_level: null,
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
        weight: currentWeightKg,
        bodyFatPercentage: clientData.currentBodyFatPercentage,
        bmr: energy.status === "ready" ? energy.bmr : undefined,
        tdee: energy.status === "ready" ? energy.tdee : undefined,
        source: "intake_sync",
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Goals are written ONCE, by `updateGoals`, which owns `client_goals` and the
  // `clients.*` mirror. The goal columns are absent from `baseInsert` above for
  // that reason.
  //
  // **This throws, and that is the point.** It used to log and continue, and a
  // swallowed failure is how a live client came to show one goal to their coach
  // and another in their own portal for six weeks with no error anywhere. On
  // failure the client row exists with no goal in EITHER store — consistent and
  // re-editable — rather than with two stores disagreeing behind a 201.
  if (clientData.goalWeight !== undefined || clientData.goalBodyFatPercentage !== undefined) {
    await updateGoals(client.id, {
      goalWeight: goalWeightKg,
      goalBodyFatPercentage: clientData.goalBodyFatPercentage,
    }, coachId);

    // `client` was mapped from the INSERT's returned row, which no longer
    // carries the goal columns, so without this the response reports no goal on
    // a client that has one.
    if (clientData.goalWeight !== undefined) {
      client.goalWeight = goalWeightKg ?? undefined;
    }
    if (clientData.goalBodyFatPercentage !== undefined) {
      client.goalBodyFatPercentage = clientData.goalBodyFatPercentage ?? undefined;
    }
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
  // Canonical on arrival — see createClient. The aliases stay because the
  // dual-write below is a trap worth naming: body-metrics-service writes its
  // own denormalized cache back to clients.current_weight in the same request,
  // so both writers must be handed the same number.
  const currentWeightKg = clientData.currentWeight;
  const goalWeightKg = clientData.goalWeight;
  const heightCm = clientData.height;

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (clientData.name !== undefined) updateData.name = clientData.name;
  if (clientData.email !== undefined) updateData.email = clientData.email;
  if (clientData.notes !== undefined) updateData.notes = clientData.notes ?? null;
  if (clientData.active !== undefined) updateData.active = clientData.active;
  if (clientData.height !== undefined) updateData.height = heightCm ?? null;
  if (clientData.gender !== undefined) updateData.gender = clientData.gender ?? null;
  // date_of_birth was accepted by updateClientSchema but never mapped here, so a
  // PATCH carrying it returned 200 and changed nothing. Age feeds Mifflin-St Jeor,
  // so a client with no birth date is silently costed at the assumed default.
  if (clientData.dateOfBirth !== undefined) updateData.date_of_birth = clientData.dateOfBirth ?? null;
  if (clientData.workActivityLevel !== undefined) updateData.work_activity_level = clientData.workActivityLevel;
  if (clientData.phone !== undefined) updateData.phone = clientData.phone || null;
  if (clientData.startDate !== undefined) updateData.start_date = clientData.startDate ?? null;
  // goal_weight / goal_body_fat_percentage are deliberately NOT in updateData —
  // `updateGoals` below owns both stores. See its comment.
  if (clientData.currentWeight !== undefined) updateData.current_weight = currentWeightKg ?? null;
  if (clientData.currentBodyFatPercentage !== undefined) updateData.current_body_fat_percentage = clientData.currentBodyFatPercentage ?? null;
  // The START values are a CORRECTION to a recorded baseline, not a new
  // measurement, and the difference decides everything below:
  //   - they are not in `energyInputChanged` — BMR/TDEE are computed from the
  //     CURRENT weight, so correcting a start value must not move them;
  //   - they are not dual-written to `body_metrics` — that log records
  //     measurements TAKEN, and stamping a correction at `now` would file this
  //     client's starting weight at the END of their timeline.
  // Neither column moves the other: a coach who also has the current value
  // wrong edits that field too (they sit side by side on the status card).
  if (clientData.startingWeight !== undefined) updateData.starting_weight = clientData.startingWeight;
  if (clientData.startingBodyFatPercentage !== undefined) {
    updateData.starting_body_fat_percentage = clientData.startingBodyFatPercentage;
  }

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

  // Recompute the energy pair whenever an INPUT to it changed. The call lives
  // here rather than at each caller so both of them — the coach PATCH and the
  // check-in metrics sync — are covered by one site and neither can forget.
  // It runs AFTER the update above commits, because the helper reads the row
  // back and must see the new measurements.
  const energyInputChanged =
    clientData.currentWeight !== undefined ||
    clientData.currentBodyFatPercentage !== undefined ||
    clientData.height !== undefined ||
    clientData.gender !== undefined ||
    clientData.dateOfBirth !== undefined ||
    clientData.workActivityLevel !== undefined;

  let energyBmr: number | undefined;
  let energyTdee: number | undefined;

  if (energyInputChanged) {
    const energy = await recalculateClientEnergy(clientId, { coachId });
    if (energy.status === "written") {
      energyBmr = energy.bmr ?? undefined;
      energyTdee = energy.tdee ?? undefined;
      // Additive: callers already reading `client` see the fresh pair without a
      // second fetch, and the shape is unchanged.
      client.bmr = energyBmr;
      client.tdee = energyTdee;
    }
  }

  // Dual-write body metrics (non-blocking)
  if (clientData.currentWeight !== undefined || clientData.currentBodyFatPercentage !== undefined) {
    try {
      await recordBodyMetrics({
        clientId,
        bmr: energyBmr,
        tdee: energyTdee,
        weight: currentWeightKg,
        bodyFatPercentage: clientData.currentBodyFatPercentage,
        source: "metrics_api",
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Goals are written ONCE, by `updateGoals`, which owns `client_goals` and the
  // `clients.*` mirror. Writing the mirror here too — as this function used to,
  // while swallowing the failure — is what let the two stores disagree: the
  // mirror took the new goal, `client_goals` kept the old one, and the request
  // returned 200.
  //
  // **This throws.** A goal edit now lands in `client_goals` or errors visibly.
  // The client's other fields are already committed above and are unaffected,
  // which is the correct split: they are independent edits that happen to travel
  // in one PATCH. The caller must say so in its error copy.
  if (clientData.goalWeight !== undefined || clientData.goalBodyFatPercentage !== undefined) {
    await updateGoals(clientId, {
      goalWeight: goalWeightKg,
      goalBodyFatPercentage: clientData.goalBodyFatPercentage,
    }, coachId ?? "coach");

    // `client` was mapped from the row read BEFORE `updateGoals` moved the
    // mirror, so without this the response echoes the previous goal back and the
    // UI renders a successful save as a no-op.
    if (clientData.goalWeight !== undefined) {
      client.goalWeight = goalWeightKg ?? undefined;
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
// Writes only the fields supplied.
//
// It no longer derives weight_unit. That column is gone (migration 141), so the
// old derivation would now PGRST204 and 500 every settings save — including the
// unit toggle itself. It was also the platform's worst data bug: it flipped the
// tag while converting zero stored numbers, so a 180 lbs client choosing Metric
// silently became a 180 kg client across every table and chart.
export const updateClientSettings = async (
  clientId: string,
  settings: UpdateSettingsInput
): Promise<Client> => {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (settings.unitPreference !== undefined) {
    updateData.unit_preference = settings.unitPreference;
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
