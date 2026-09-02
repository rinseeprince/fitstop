import { supabaseAdmin } from "./supabase-admin";
import type { Client } from "@/types/check-in";
import type {
  CreateClientInput,
  UpdateClientInput,
  UpdateCheckInConfigInput,
  UpdateSettingsInput,
} from "@/lib/validations/client";
import type { ClientRow, ClientRowWithMeasurements } from "@/lib/database-helpers";
import { mapClientRow } from "@/lib/mappers";
import { createIntake } from "@/services/client-intake-service";
import { sendInvitation } from "@/services/invitation-service";
import { invalidateClientAuthCache } from "@/lib/auth-cache";
import {
  appendMeasurements,
  CLIENT_MEASUREMENT_EMBEDS,
  ReadingRemovalUnavailableError,
} from "@/services/measurements-service";
import { recordClientStart } from "@/services/client-start-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";
import { computeEnergyPair } from "@/services/client-energy-calc";
import { getClientTodayString, getCoachTodayString } from "@/services/today-service";

// Every read that maps to a `Client` carries the two measurement views, so the
// four reading fields are filled in the same round trip as the row.
const CLIENT_SELECT = `*, ${CLIENT_MEASUREMENT_EMBEDS}`;

/** The day a coach's entry is dated: the coach's calendar when one is in
 *  hand (they are the setter), else the client's. */
async function todayFor(clientId: string, coachId?: string): Promise<string> {
  return coachId ? getCoachTodayString(coachId) : getClientTodayString(clientId);
}

// Extended client type with check-in info
type ClientWithCheckInInfo = Client & {
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
    // The add-client form collects it, the schema validates it, and
    // computeEnergyPair above USES it — it was simply never written, so a
    // manually-added client's birth date survived exactly long enough to set
    // their BMR and was then discarded. Worse than merely missing: their stored
    // BMR was age-correct while their profile showed no age, so the next
    // recalculation fell back to the assumed 30 and silently produced a
    // different number. (The intake path was unaffected — it syncs the field
    // separately.)
    date_of_birth: clientData.dateOfBirth ?? null,
    // goal_weight / goal_body_fat_percentage are deliberately ABSENT.
    // `updateGoals` below is the single writer of both stores — it inserts the
    // `client_goals` row and mirrors it onto `clients` — so writing them here
    // too would reopen the window it exists to close: the mirror holding a goal
    // that `client_goals` never received.
    //
    // No weight columns either: the reading is a row in the measurement log
    // (below), and "now" and "at the start" are derived from that log.
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

  // The first reading: an `intake` row in the measurement log, dated the day
  // the coach captured it. The pair in the INSERT above was computed from the
  // same number, so the recompute this append triggers changes nothing. It
  // THROWS (CONVENTIONS §2 item 13 — the row exists, the reading does not, the
  // request reports failure): a client whose starting weight was never
  // recorded is one activation refuses, and a swallowed failure here is how a
  // profile came to claim a reading no row carried.
  if (currentWeightKg !== undefined || clientData.currentBodyFatPercentage !== undefined) {
    const appended = await appendMeasurements({
      clientId: client.id,
      source: "intake",
      recordedOn: await getCoachTodayString(coachId),
      values: { weight: currentWeightKg, bodyFat: clientData.currentBodyFatPercentage },
    });
    // The INSERT's returned row carries no embeds, so without this the
    // response reports a client with no reading a moment after recording one.
    client.currentWeight = appended.rows.weight?.value;
    client.currentBodyFatPercentage = appended.rows.bodyFat?.value;
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
    .select(CLIENT_SELECT)
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

  return mapClientRow(data as ClientRowWithMeasurements);
};

// Update a client
export const updateClient = async (
  clientId: string,
  clientData: UpdateClientInput,
  coachId?: string
): Promise<Client> => {
  // Withdrawing a reading is a void, and voids arrive with the correct/remove
  // commit. Until then a cleared body fat is refused BEFORE any write lands,
  // so the coach reads a sentence rather than a save that kept the value.
  if (clientData.currentBodyFatPercentage === null) {
    throw new ReadingRemovalUnavailableError("body fat");
  }
  if (clientData.startingBodyFatPercentage === null) {
    throw new ReadingRemovalUnavailableError("start body fat");
  }

  // Canonical on arrival — see createClient.
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
  // start_date is NOT written here: the origin has one writer, recordClientStart
  // below. No reading is written here either — every weight and body fat on
  // this input becomes a row in the measurement log (below), never a column.
  // goal_weight / goal_body_fat_percentage are deliberately NOT in updateData —
  // `updateGoals` below owns both stores. See its comment.

  const { data, error } = await supabaseAdmin
    .from("clients")
    .update(updateData)
    .eq("id", clientId)
    .select(CLIENT_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A client with this email already exists");
    }
    console.error("Failed to update client:", error);
    throw new Error("Failed to update client");
  }

  const client = mapClientRow(data as ClientRowWithMeasurements);

  // If this update deactivated the client, bust its cached auth mapping too
  // (the PATCH /api/clients/[id] active:false path, distinct from deleteClient).
  if (clientData.active === false && data.user_id) {
    await invalidateClientAuthCache(data.user_id);
  }

  // Recompute the energy pair whenever a PROFILE input to it changed. A
  // reading (weight, body fat) recomputes it from inside the measurement log's
  // append below, when the row is the client's newest — so the two triggers
  // cannot disagree about which number the pair was built from. It runs
  // AFTER the update above commits, because the helper reads the row back.
  const energyInputChanged =
    clientData.height !== undefined ||
    clientData.gender !== undefined ||
    clientData.dateOfBirth !== undefined ||
    clientData.workActivityLevel !== undefined;

  if (energyInputChanged) {
    const energy = await recalculateClientEnergy(clientId, { coachId });
    if (energy.status === "written") {
      // Additive: callers already reading `client` see the fresh pair without a
      // second fetch, and the shape is unchanged.
      client.bmr = energy.bmr ?? undefined;
      client.tdee = energy.tdee ?? undefined;
    }
  }

  // The client's ORIGIN, through its single writer. A date and nothing else:
  // the baseline is derived from the log as the reading as of that date, so
  // moving the date re-derives it and re-dates nothing. This THROWS.
  if (clientData.startDate !== undefined) {
    await recordClientStart(clientId, { startsOn: clientData.startDate });
  }

  let readingsChanged = false;

  // The details sheet's Baseline fields: a coach entry dated ON the start
  // date, which the derived baseline then reads. Before activation there is no
  // start date to date it on, so it is an `intake` reading dated today — the
  // as-of rule picks it up the moment the date is set.
  const baselineValues = {
    weight: clientData.startingWeight,
    bodyFat: clientData.startingBodyFatPercentage ?? undefined,
  };
  if (baselineValues.weight !== undefined || baselineValues.bodyFat !== undefined) {
    const startsOn = clientData.startDate ?? data.start_date ?? null;
    await appendMeasurements(
      startsOn
        ? {
            clientId,
            source: "coach_entry",
            recordedOn: startsOn,
            values: baselineValues,
            createdBy: coachId ?? null,
          }
        : {
            clientId,
            source: "intake",
            recordedOn: await todayFor(clientId, coachId),
            values: baselineValues,
          }
    );
    readingsChanged = true;
  }

  // A current reading on this wire is the coach's entry, dated today.
  const measuredBodyFat = clientData.currentBodyFatPercentage ?? undefined;
  if (currentWeightKg !== undefined || measuredBodyFat !== undefined) {
    await appendMeasurements({
      clientId,
      source: "coach_entry",
      recordedOn: await todayFor(clientId, coachId),
      values: { weight: currentWeightKg, bodyFat: measuredBodyFat },
      createdBy: coachId ?? null,
    });
    readingsChanged = true;
  }

  // `client` was read before the readings landed, so re-read the derived
  // fields — "now", the baseline and the pair the append may have recomputed —
  // rather than echo a save that changed them back as unchanged.
  if (readingsChanged) {
    const fresh = await getClientById(clientId, true);
    if (fresh) {
      client.currentWeight = fresh.currentWeight;
      client.currentBodyFatPercentage = fresh.currentBodyFatPercentage;
      client.startingWeight = fresh.startingWeight;
      client.startingBodyFatPercentage = fresh.startingBodyFatPercentage;
      client.bmr = fresh.bmr;
      client.tdee = fresh.tdee;
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
    next_check_in_due: config.nextCheckInDue ?? null,
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
