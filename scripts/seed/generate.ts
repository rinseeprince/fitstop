/**
 * Row generation for the scale seed.
 *
 * One coach and its roster are generated as an ordered list of write steps, so
 * the caller can flush a coach at a time. That bounds memory (the old scale seed
 * built everything up front, which is >1GB of JS objects at this volume) and
 * gives natural progress granularity.
 *
 * The write order below is the dependency order established in Phase 0. Two
 * places in it are not obvious:
 *
 *  - `nutrition_events` MUST follow `training_events`: `is_training_day` and
 *    `calorie_surplus_percentage` are read off the day's training event, and a
 *    dropped surplus silently falls nutrition back to rest-day calories while
 *    the TRAIN badge still renders.
 *  - `training_events` <-> `session_logs` is a cycle (both FKs nullable). Events
 *    go in first with `session_log_id` NULL, then session_logs carrying
 *    `training_event_id`, then a second pass upserts the back-link. That pass is
 *    safe specifically because `training_events` has no `updated_at` trigger —
 *    the same second pass on `session_logs` would destroy its backdated stamps.
 *
 * Everything is written in the INITIAL insert wherever possible: 25 tables carry
 * BEFORE UPDATE `updated_at` triggers, so any second pass re-stamps the row to
 * wall-clock time and destroys the backdated history the benchmark depends on.
 */

import { compactFromSpecs, type SetSpec, type SetType } from "@/utils/exercise-set-specs";
import { computeEnergyPair } from "@/services/client-energy-calc";
import { seedUuid, seedEmail } from "./ids";
import { streamFor, type Rng } from "./rng";
import {
  ARCHETYPES, COACH_TIERS, SATURATED_ARCHETYPE, drawArchetype, pickBreaks, pickTenure, logsOnDay,
  addDays, dayOfWeekName, mondayOf, timestampAt,
  wellnessHour, nutritionHour, sessionHour, checkInHour,
  coachNote, checkInResponse, aiReviewText, aiInsightsV3, aiRecommendations,
  nutritionAdherenceStatus, DIET_TYPES,
  SPLIT_TYPES, SESSION_NAMES, HABIT_NAMES, TIMEZONES, EXERCISE_POOL,
  type Archetype, type CoachTier,
} from "./model";

export type CatalogExercise = {
  id: string | null;
  name: string;
  compound: boolean;
  base: number;
};

export type Step = {
  table: string;
  rows: Record<string, unknown>[];
  /** upsert is used only for the training_events back-link pass. */
  mode?: "insert" | "upsert";
  onConflict?: string;
};

export type SeedContext = {
  seed: number;
  /** The "today" the whole dataset is anchored to. Never read from the clock. */
  anchorDate: string;
  windowDays: number;
  clientsPerCoach: number;
  catalog: readonly CatalogExercise[];
  /** Which client indices get a real auth user (RLS personas). */
  personaClientIndices: ReadonlySet<number>;
  /**
   * Coaches whose ENTIRE roster is forced to the worst case: full client count,
   * full window, full plan coverage, top-of-scale engagement. See
   * SATURATED_ARCHETYPE. Everyone outside this set keeps the skewed
   * distribution untouched.
   */
  saturatedCoachIndices: ReadonlySet<number>;
};

/** Plan coverage by archetype — weighted ≈ 0.57 of clients carry placed programs. */
const PLAN_COVERAGE: Record<string, number> = {
  power: 1.0, steady: 0.8, lapsing: 0.4, churned: 0.15, never_start: 0,
};

const BLOCK_DAYS = 60;
const BLOCKS_PER_CLIENT = 3;
/** Non-rest slots per week. 4/7 ≈ 0.571 — the frequency_per_week the plan records. */
const TRAIN_DAYS_PER_WEEK = 4;

// --------------------------------------------------------------- helpers

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Deterministic name from an index, so a coach/client is recognisable in the UI. */
const FIRST = ["Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie", "Avery", "Quinn",
  "Rowan", "Sasha", "Devon", "Harper", "Reese", "Skyler", "Emerson", "Finley", "Hayden", "Kendall"];
const LAST = ["Bennett", "Carter", "Dawson", "Ellis", "Fletcher", "Grant", "Hayes", "Ingram", "Jarvis",
  "Keller", "Lawson", "Mercer", "Norton", "Osborne", "Porter", "Quinlan", "Rhodes", "Sutton", "Turner", "Vance"];

function personName(rng: Rng): string {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

/** Pick this client's exercise rotation from the live catalog (or the fallback pool). */
function pickExercises(catalog: readonly CatalogExercise[], rng: Rng, n: number): CatalogExercise[] {
  const compounds = catalog.filter((e) => e.compound);
  const isolation = catalog.filter((e) => !e.compound);
  const picked: CatalogExercise[] = [];
  const wantCompound = Math.min(2, compounds.length);
  picked.push(...rng.shuffle(compounds).slice(0, wantCompound));
  picked.push(...rng.shuffle(isolation).slice(0, Math.max(0, n - picked.length)));
  // If the catalog is thin, top up from whatever exists rather than returning short.
  while (picked.length < n && catalog.length > 0) picked.push(rng.pick(catalog));
  return picked.slice(0, n);
}

// ------------------------------------------------------------ generation

export function generateCoachBundle(coachIdx: number, ctx: SeedContext): Step[] {
  const { seed, anchorDate, windowDays, clientsPerCoach, catalog } = ctx;
  const windowStart = addDays(anchorDate, -(windowDays - 1));

  const coachRng = streamFor(seed, "coach", coachIdx);
  const coachId = seedUuid("coach", coachIdx);
  const isSaturated = ctx.saturatedCoachIndices.has(coachIdx);
  // A saturated coach is a "full" tier by definition; the draw is still made so
  // the coach stream stays positionally identical either way, which keeps the
  // coach's own identity fields stable when the saturated set changes.
  const drawnTier: CoachTier = coachRng.weighted(COACH_TIERS);
  const tier: CoachTier = isSaturated ? "full" : drawnTier;
  const coachCreatedAt = timestampAt(addDays(windowStart, -coachRng.int(30, 400)), 10, coachRng);

  const steps: Step[] = [];
  const push = (table: string, rows: Record<string, unknown>[], mode?: "insert" | "upsert", onConflict?: string) => {
    if (rows.length > 0) steps.push({ table, rows, mode, onConflict });
  };

  push("coaches", [{
    id: coachId,
    user_id: null, // linked separately for the RLS personas only
    name: personName(coachRng),
    email: seedEmail("coach", coachIdx),
    timezone: coachRng.weighted([["UTC", 6], ...TIMEZONES.slice(1).map((t) => [t, 1] as const)] as const),
    created_at: coachCreatedAt,
    updated_at: coachCreatedAt,
  }]);

  // Accumulators, so each table is written as one ordered batch per coach.
  const clients: Record<string, unknown>[] = [];
  const invitations: Record<string, unknown>[] = [];
  const goals: Record<string, unknown>[] = [];
  const habits: Record<string, unknown>[] = [];
  const plans: Record<string, unknown>[] = [];
  const sessions: Record<string, unknown>[] = [];
  const exercises: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const nPlans: Record<string, unknown>[] = [];
  const nTargets: Record<string, unknown>[] = [];
  const nEvents: Record<string, unknown>[] = [];
  const dailyLogs: Record<string, unknown>[] = [];
  const wellness: Record<string, unknown>[] = [];
  const nutritionLogs: Record<string, unknown>[] = [];
  const habitLogs: Record<string, unknown>[] = [];
  const sessionLogs: Record<string, unknown>[] = [];
  const exerciseLogs: Record<string, unknown>[] = [];
  const setLogs: Record<string, unknown>[] = [];
  /** The measurement log: every body reading, stamped or coach-logged. */
  const measurements: Record<string, unknown>[] = [];
  const checkIns: Record<string, unknown>[] = [];
  /** eventId -> the row object, so the back-link pass can re-emit it in full. */
  const eventRowById = new Map<string, Record<string, unknown>>();
  /** eventId -> session_log_id, resolved once session logs exist. */
  const backLink = new Map<string, string>();

  for (let c = 0; c < clientsPerCoach; c++) {
    const clientIdx = coachIdx * clientsPerCoach + c;
    const idRng = streamFor(seed, "client", coachIdx, c, "identity");
    const clientId = seedUuid("client", coachIdx, c);

    // The draws are made unconditionally and then overridden, so the saturated
    // branch consumes the identity stream at exactly the same positions as the
    // skewed branch. Everything downstream of these three values (weights,
    // names, habits) is therefore unchanged by flipping a coach saturated.
    const drawnArchetype: Archetype = drawArchetype(tier, idRng);
    const drawnTenure = pickTenure(windowDays, idRng);

    // Worst case, guaranteed rather than sampled: the complete window at
    // top-of-scale engagement, with no holiday gaps. This is the client the
    // per-coach roster read has to survive 20 of.
    const archetype: Archetype = isSaturated ? SATURATED_ARCHETYPE : drawnArchetype;
    const tenureDays = isSaturated ? windowDays : drawnTenure;

    const startIso = addDays(anchorDate, -(tenureDays - 1));
    const createdAt = timestampAt(startIso, idRng.int(9, 17), idRng);
    const drawnBreaks = pickBreaks(tenureDays, idRng);
    const breaks = isSaturated ? [] : drawnBreaks;

    const heightCm = idRng.int(158, 195);
    const startWeight = round(idRng.gauss(82, 12, 52, 135), 1);
    const goalWeight = round(startWeight - idRng.float(3, 14), 1);
    const startBf = round(idRng.gauss(24, 5, 10, 40), 1);
    // Hoisted above the energy computation so the seeded pair derives from the
    // SAME gender/age/activity the row is inserted with. They used to be picked
    // further down while bmr came from an inline Katch-McArdle copy and tdee
    // from a random 1.35-1.75 multiplier, so a "very_active" fixture could carry
    // a sedentary-looking TDEE — the exact incoherence Session 4B removed from
    // the app.
    const gender = idRng.pick(["male", "female", "other"] as const);
    const dateOfBirth = addDays(anchorDate, -idRng.int(19, 60) * 365);
    const workActivityLevel = idRng.pick([
      "sedentary",
      "lightly_active",
      "moderately_active",
      "very_active",
    ] as const);
    const checkInDay = idRng.pick(["monday", "sunday", "friday", "wednesday"] as const);
    // The schedule is the stored DATE (migration 154); checkInDay survives only
    // as the rhythm the generated check-ins below follow. The seeded due date is
    // the next occurrence of that weekday on or after the anchor, which is what
    // a client who has been checking in up to today would hold.
    let nextCheckInDue = anchorDate;
    while (dayOfWeekName(nextCheckInDue) !== checkInDay) {
      nextCheckInDue = addDays(nextCheckInDue, 1);
    }
    const isPersona = ctx.personaClientIndices.has(clientIdx);

    // Weight drifts toward goal over the tenure. The latest reading in the
    // measurement log is what every "now" reader derives from; the profile
    // pair below is computed from the same number so the two agree.
    const weightAt = (dayIndex: number): number =>
      round(startWeight + (goalWeight - startWeight) * (dayIndex / Math.max(tenureDays, 1)) * idRng.float(0.55, 0.95), 1);
    const finalWeight = weightAt(tenureDays - 1);
    const finalBf = round(Math.max(8, startBf - (startWeight - finalWeight) * 0.55), 1);

    // The profile pair, through the app's own calculator — so a seeded fixture
    // can never contradict what recalculateClientEnergy would produce for the
    // same row. Derived from the CURRENT weight/body fat (the newest reading
    // in the measurement log), with the anchor date as the clock so `--seed`
    // stays byte-deterministic.
    const energy = computeEnergyPair({
      weightKg: finalWeight,
      heightCm,
      gender,
      bodyFatPercentage: finalBf,
      dateOfBirth,
      activityLevel: workActivityLevel,
      now: new Date(`${anchorDate}T12:00:00Z`),
    });
    if (energy.status !== "ready") {
      throw new Error(
        `Seed client ${clientIdx} is not computable: missing ${energy.missing.join(", ")}`
      );
    }
    const bmr = energy.bmr;
    const tdee = energy.tdee;

    clients.push({
      id: clientId,
      coach_id: coachId,
      name: personName(idRng),
      email: seedEmail("client", clientIdx),
      active: true,
      user_id: null, // set by the entry script for personas only
      created_at: createdAt,
      updated_at: createdAt,
      onboarding_status: "active", // anything else renders the portal waiting screen
      start_date: startIso,
      timezone: idRng.weighted([["UTC", 7], ...TIMEZONES.slice(1).map((t) => [t, 1] as const)] as const),
      check_in_frequency: idRng.weighted([["weekly", 8], ["biweekly", 2]] as const),
      next_check_in_due: nextCheckInDue,
      unit_preference: idRng.weighted([["metric", 7], ["imperial", 3]] as const),
      height: heightCm,
      gender,
      date_of_birth: dateOfBirth,
      work_activity_level: workActivityLevel,
      include_activity_burn: idRng.bool(0.7),
      surplus_as_carbs: idRng.bool(0.4),
      // No weight columns: "now" and "at the start" are derived from the
      // measurement log (the intake row on the start date below is the
      // baseline; the last fortnightly coach entry is "now").
      goal_weight: goalWeight,
      goal_body_fat_percentage: round(Math.max(8, startBf - 6), 1),
      bmr,
      tdee,
      notes: idRng.bool(0.55) ? coachNote(idRng) : null,
      welcome_message: idRng.bool(0.3) ? coachNote(idRng) : null,
      // current_streak / longest_streak are written by nothing in the app; left at
      // their defaults rather than inventing a value the read side disagrees with.
    });

    // An invitation must precede the auth user, or handle_new_user derives
    // role='trainer' and inserts a spurious coaches row per client.
    if (isPersona) {
      invitations.push({
        id: seedUuid("invitation", coachIdx, c),
        client_id: clientId,
        email: seedEmail("client", clientIdx),
        status: "accepted",
        token: seedUuid("invtoken", coachIdx, c).replace(/-/g, ""),
        invited_at: createdAt,
        accepted_at: createdAt,
        expires_at: timestampAt(addDays(startIso, 14), 12, idRng),
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    goals.push({
      id: seedUuid("goal", coachIdx, c),
      client_id: clientId,
      goal_weight: goalWeight,
      goal_body_fat_percentage: round(Math.max(8, startBf - 6), 1),
      primary_goal: idRng.pick(["fat_loss", "muscle_gain", "recomposition", "performance"] as const),
      set_by: "coach",
      notes: idRng.bool(0.4) ? coachNote(idRng) : null,
      effective_from: startIso,
      goal_start_date: startIso,
      superseded_at: null, // partial unique (client_id) WHERE superseded_at IS NULL
      created_at: createdAt,
      updated_at: createdAt,
    });

    // --- habits. effective_date MUST be backdated: the adherence read filters
    // effective_date <= date, so leaving the CURRENT_DATE default makes every
    // historical habit rail compute against zero eligible habits.
    const habitCount = idRng.int(2, 4);
    const clientHabits = idRng.shuffle(HABIT_NAMES).slice(0, habitCount).map((name, i) => ({
      id: seedUuid("habit", coachIdx, c, i),
      coach_id: coachId,
      client_id: clientId,
      name,
      is_boolean: true,
      is_active: true,
      sort_order: i,
      effective_date: startIso,
      created_at: createdAt,
      updated_at: createdAt,
    }));
    habits.push(...clientHabits);

    // ---------------------------------------------------------- training

    const planRng = streamFor(seed, "client", coachIdx, c, "plans");
    // Saturated clients always carry a placed program — a 180-day tenure with
    // no plan would be a dense LOGGING client with an empty training calendar,
    // which is not the case the roster query has to survive.
    const drawnHasPlan = planRng.bool(PLAN_COVERAGE[archetype.key] ?? 0);
    const hasPlan = isSaturated ? true : drawnHasPlan;
    const clientExercises = pickExercises(catalog, planRng, 8);

    /** date -> the session row prescribed for it, for the whole tenure. */
    const slotByDate = new Map<string, { sessionId: string; name: string; isRest: boolean; surplus: number | null; planId: string }>();

    if (hasPlan) {
      // Three consecutive ~60-day blocks, so "which plan was active on date X"
      // is a real lookup rather than a single covering row. effective_from must
      // be strictly increasing — getNextPlanStartCap uses a strict `>`.
      for (let b = 0; b < BLOCKS_PER_CLIENT; b++) {
        const blockStartIdx = b * BLOCK_DAYS;
        if (blockStartIdx >= tenureDays) break;
        const planId = seedUuid("plan", coachIdx, c, b);
        const effFrom = addDays(startIso, blockStartIdx);
        const blockLen = Math.min(BLOCK_DAYS, tenureDays - blockStartIdx);

        plans.push({
          id: planId,
          client_id: clientId,
          coach_id: coachId,
          name: `${planRng.pick(SPLIT_TYPES).replace(/_/g, " ")} block ${b + 1}`,
          status: "active",
          coach_prompt: "Seeded programme block.", // NOT NULL, vestigial AI field
          split_type: planRng.pick(SPLIT_TYPES),
          frequency_per_week: TRAIN_DAYS_PER_WEEK, // per-week average, CHECK 1..7
          program_duration_weeks: Math.round(blockLen / 7),
          effective_from: effFrom,
          effective_until: null,
          client_weight_kg: weightAt(blockStartIdx),
          client_goal_weight_kg: goalWeight,
          client_tdee: tdee,
          deleted_at: null,
          created_at: timestampAt(effFrom, 11, planRng),
          updated_at: timestampAt(effFrom, 11, planRng),
        });

        // One training_sessions row per authored day-slot INCLUDING rest days —
        // rest slots emit no event but still advance the date-walk position, so
        // a missing one slides every later date.
        for (let d = 0; d < blockLen; d++) {
          const dayIdx = blockStartIdx + d;
          const iso = addDays(startIso, dayIdx);
          const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
          // Train Mon/Tue/Thu/Fri; rest Wed/Sat/Sun.
          const isRest = dow === 0 || dow === 3 || dow === 6;
          const sessionId = seedUuid("session", coachIdx, c, b, d);
          const surplus = isRest ? null : planRng.int(5, 20);
          const name = isRest ? "Rest" : planRng.pick(SESSION_NAMES);

          sessions.push({
            id: sessionId,
            plan_id: planId,
            name,
            // Slot POSITION in the program, not the calendar weekday.
            //
            // Placement is a sequential date-walk: library-placement-service
            // sorts by (week_index, order_index) and walks one day per slot, so
            // the Nth slot in that order MUST land on effective_from + N. The
            // previous `floor(d/7)*7 + dow` used the real weekday of the date,
            // which only coincides with the walk when the block happens to start
            // on a Sunday — otherwise the reconstructed date disagreed with the
            // `date` stamped on training_events for 73% of slots.
            //
            // order_index is plan-GLOBAL and monotonic, not within-week 0..6:
            // placeSessionOnCalendar appends (week_index 2, order_index 20) ->
            // (2, 21), and derives week_index as floor(order_index / 7).
            order_index: d,
            week_index: Math.floor(d / 7),
            is_rest: isRest,
            is_active: true,
            focus: isRest ? null : name,
            estimated_duration_minutes: isRest ? null : planRng.int(45, 85),
            calorie_surplus_percentage: surplus,
            created_at: timestampAt(effFrom, 11, planRng),
            updated_at: timestampAt(effFrom, 11, planRng),
          });

          slotByDate.set(iso, { sessionId, name, isRest, surplus, planId });

          if (!isRest) {
            // Prescribed exercises per session. Sized so the LOGGED count below
            // can average the 5.57 exercise_logs per session_log measured off
            // live data without a client logging more exercises than they were
            // given — the previous int(4,6) capped the achievable ratio at
            // mean(5) x P(setDetail) ~= 4.07, which no gate tuning could fix.
            const exCount = planRng.int(5, 8);
            const chosen = planRng.shuffle(clientExercises).slice(0, exCount);
            chosen.forEach((ex, i) => {
              const repsMin = planRng.int(5, 8);
              const repsMax = planRng.int(9, 12);
              const rpeTarget = planRng.int(6, 9);
              const restSeconds = planRng.pick([60, 90, 120, 180]);
              const workingSets = planRng.int(3, 5);

              // set_specs is the jsonb that makes this table ~1KB/row — the
              // second-largest table in the seed. Populated because that row
              // size is part of what the benchmark is measuring.
              //
              // The keys are the SetSpec shape from utils/exercise-set-specs
              // (snake_case set_number/set_type/reps_min/reps_max/rpe_target),
              // not a camelCase invention: countWorkingSets keys off `set_type`
              // and silently treats an unrecognised spec as a working set, so a
              // wrong-shaped array mis-counts every prescription instead of
              // failing. A last-set amrap keeps the set_type-aware analytics
              // (migration 120) on a non-degenerate distribution.
              const specs: SetSpec[] = [
                {
                  set_number: 1,
                  set_type: "warmup",
                  reps_min: repsMin,
                  reps_max: repsMax,
                  rpe_target: null,
                  rest_seconds: restSeconds,
                },
                ...Array.from({ length: workingSets }, (_, s) => ({
                  set_number: s + 2,
                  set_type: (s === workingSets - 1 && planRng.bool(0.15)
                    ? "amrap"
                    : "working") as SetType,
                  reps_min: repsMin,
                  reps_max: repsMax,
                  rpe_target: rpeTarget,
                  rest_seconds: restSeconds,
                })),
              ];
              // set_specs is authoritative; the compact columns are a MAINTAINED
              // PROJECTION of it, never an independent draw (see
              // projectExerciseCompact). Drawing `sets` separately is what
              // "silently corrupts a coach's programming" in the app's own words,
              // and it also drifts from the training_exercises.sets CHECK [1,20]
              // that compactFromSpecs clamps to.
              const compact = compactFromSpecs(specs);

              exercises.push({
                id: seedUuid("texercise", coachIdx, c, b, d, i),
                session_id: sessionId,
                exercise_id: ex.id,
                name: ex.name,
                order_index: i,
                sets: compact.sets,
                reps_min: compact.repsMin,
                reps_max: compact.repsMax,
                rpe_target: rpeTarget,
                rest_seconds: restSeconds,
                is_active: true,
                is_warmup: false,
                set_specs: specs,
                created_at: timestampAt(effFrom, 11, planRng),
                updated_at: timestampAt(effFrom, 11, planRng),
              });
            });
          }
        }
      }
    }

    // ------------------------------------------------------- daily history

    const logRng = streamFor(seed, "client", coachIdx, c, "logs");
    // Must be a member of the closed DietType union: calculateDailyMacros does
    // `dietSplits[dietType].fat`, so an unknown value is a TypeError at read
    // time. The column is plain text with no CHECK, so nothing here would fail.
    const dietType = logRng.pick(DIET_TYPES);
    const baseCals = Math.round(tdee * logRng.float(0.82, 0.95));
    const proteinG = Math.round(startWeight * logRng.float(1.8, 2.3));
    const fatG = Math.round((baseCals * logRng.float(0.22, 0.3)) / 9);
    const carbG = Math.max(40, Math.round((baseCals - proteinG * 4 - fatG * 9) / 4));

    // Versioned model (migration 144): each client gets a CLOSED predecessor
    // version + the OPEN current one, tiling the tenure at its midpoint, so
    // "which version governed date X" is a real lookup against seed data
    // (mirroring the training side's consecutive blocks). Short tenures fall
    // back to a single open version. The open guard is now the partial unique
    // index idx_nutrition_plans_open_unique — (client_id) WHERE
    // status='active' AND effective_until IS NULL — so a pair of active rows
    // is legal as long as exactly one is open.
    const nPlanId = seedUuid("nplan", coachIdx, c);
    const splitVersions = tenureDays >= 14;
    const v2FromIso = splitVersions ? addDays(startIso, Math.floor(tenureDays / 2)) : startIso;
    const sharedPlanCols = {
      client_id: clientId,
      coach_id: coachId,
      name: "Seeded nutrition plan",
      status: "active",
      work_activity_level: "moderately_active",
      training_volume_hours: "3-5",
      diet_type: dietType,
      protein_target_g: proteinG,
      carb_target_g: carbG,
      fat_target_g: fatG,
      base_weight_kg: startWeight,
      bmr,
      tdee,
      custom_macros_enabled: false,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const nPlanV1Id = seedUuid("nplanv1", coachIdx, c);
    if (splitVersions) {
      nPlans.push({
        ...sharedPlanCols,
        id: nPlanV1Id,
        effective_from: startIso,
        effective_until: addDays(v2FromIso, -1),
        baseline_calories: Math.max(1200, baseCals - 100),
      });
    }
    nPlans.push({
      ...sharedPlanCols,
      id: nPlanId,
      effective_from: v2FromIso,
      effective_until: null,
      baseline_calories: baseCals,
    });

    // All 7 weekday rows, always, PER VERSION. A missing weekday falls through
    // to calculateDailyMacros and the seeded numbers stop matching the plan.
    for (let d = 0; d < 7; d++) {
      const dowName = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d];
      const training = d !== 0 && d !== 3 && d !== 6;
      if (splitVersions) {
        const v1Cals = Math.max(1200, baseCals - 100);
        nTargets.push({
          id: seedUuid("ntargetv1", coachIdx, c, d),
          nutrition_plan_id: nPlanV1Id,
          day_of_week: dowName,
          is_training_day: training,
          calories: training ? Math.round(v1Cals * 1.08) : v1Cals,
          protein_g: proteinG,
          carb_g: training ? Math.round(carbG * 1.2) : carbG,
          fat_g: fatG,
        });
      }
      nTargets.push({
        id: seedUuid("ntarget", coachIdx, c, d),
        nutrition_plan_id: nPlanId,
        day_of_week: dowName,
        is_training_day: training,
        calories: training ? Math.round(baseCals * 1.08) : baseCals,
        protein_g: proteinG,
        carb_g: training ? Math.round(carbG * 1.2) : carbG,
        fat_g: fatG,
      });
    }

    let checkInsWritten = 0;

    for (let dayIdx = 0; dayIdx < tenureDays; dayIdx++) {
      const iso = addDays(startIso, dayIdx);
      const slot = slotByDate.get(iso);
      const isTrainingDay = !!slot && !slot.isRest;
      const surplus = slot?.surplus ?? null;

      // --- training event (prescription). One per non-rest slot; the partial
      // unique index caps this at one *scheduled* row per client per date.
      let eventId: string | null = null;
      let completed = false;
      let quality: "full" | "partial" | "skipped" = "full";
      if (isTrainingDay && slot) {
        eventId = seedUuid("event", coachIdx, c, dayIdx);
        completed = logRng.bool(archetype.sessionCompletion) && dayIdx < tenureDays * archetype.churnAt;
        quality = completed
          ? logRng.weighted([["full", 8], ["partial", 2]] as const)
          : "skipped";
        // Adherence counts only status='completed'. A seed that writes session
        // logs and leaves every event 'scheduled' reads as 0% adherence.
        const status = completed ? (quality === "full" ? "completed" : "partial") : "scheduled";
        const eventRow: Record<string, unknown> = {
          id: eventId,
          client_id: clientId,
          training_plan_id: slot.planId,
          training_session_id: slot.sessionId,
          date: iso,
          session_name: slot.name,
          session_focus: slot.name,
          status,
          // Keep calorie_surplus_percentage populated on EVERY training event
          // write — nutrition reads it off this row.
          calorie_surplus_percentage: surplus,
          estimated_calories: logRng.int(280, 620),
          is_modified: false,
          session_log_id: null, // back-linked after session_logs exist
          created_at: timestampAt(iso, 8, logRng),
          updated_at: timestampAt(iso, 8, logRng),
        };
        events.push(eventRow);
        eventRowById.set(eventId, eventRow);
      }

      // --- nutrition event (dense prescription, one per client-day) —
      // stamped with the version whose window covers this date (migration 144)
      const eraPlanId = splitVersions && iso < v2FromIso ? nPlanV1Id : nPlanId;
      const eraBaseCals = splitVersions && iso < v2FromIso ? Math.max(1200, baseCals - 100) : baseCals;
      nEvents.push({
        id: seedUuid("nevent", coachIdx, c, dayIdx),
        client_id: clientId,
        nutrition_plan_id: eraPlanId,
        date: iso,
        day_of_week: dayOfWeekName(iso),
        baseline_calories: eraBaseCals,
        training_burn_calories: isTrainingDay ? logRng.int(250, 550) : 0,
        protein_g: proteinG,
        carb_g: isTrainingDay ? Math.round(carbG * 1.2) : carbG,
        fat_g: fatG,
        diet_type: dietType,
        is_training_day: isTrainingDay,
        calorie_surplus_percentage: surplus,
        status: "scheduled",
        is_modified: false,
        created_at: timestampAt(iso, 6, logRng),
        updated_at: timestampAt(iso, 6, logRng),
      });

      // --- actuals: only on days the client actually engaged
      const logs = logsOnDay(archetype, dayIdx, tenureDays, iso, breaks, logRng);

      if (logs) {
        const dailyLogId = seedUuid("dlog", coachIdx, c, dayIdx);
        dailyLogs.push({
          id: dailyLogId,
          client_id: clientId,
          date: iso,
          notes: logRng.bool(0.12) ? coachNote(logRng) : null,
          created_at: timestampAt(iso, wellnessHour(logRng), logRng),
          updated_at: timestampAt(iso, wellnessHour(logRng), logRng),
        });

        // wellness_logs has ZERO check constraints — the 1-10 scales (and mood,
        // which is 1-5 on check_ins) are convention only. Held to the app's
        // ranges deliberately.
        wellness.push({
          id: seedUuid("wlog", coachIdx, c, dayIdx),
          daily_log_id: dailyLogId,
          client_id: clientId,
          date: iso,
          mood: logRng.int(2, 5),
          energy: logRng.int(3, 9),
          sleep: logRng.int(3, 9),
          stress: logRng.int(2, 8),
          soreness: logRng.int(1, 8),
          created_at: timestampAt(iso, wellnessHour(logRng), logRng),
          updated_at: timestampAt(iso, wellnessHour(logRng), logRng),
        });

        if (logRng.bool(0.8)) {
          const targetCals = isTrainingDay ? Math.round(baseCals * 1.08) : baseCals;
          const consumed = Math.round(targetCals * logRng.gauss(1.0, 0.12, 0.6, 1.4));
          nutritionLogs.push({
            id: seedUuid("nlog", coachIdx, c, dayIdx),
            daily_log_id: dailyLogId,
            client_id: clientId,
            date: iso,
            nutrition_plan_id: eraPlanId,
            calories_consumed: consumed,
            protein_g: Math.round(proteinG * logRng.float(0.7, 1.15)),
            carbs_g: Math.round(carbG * logRng.float(0.6, 1.3)),
            fat_g: Math.round(fatG * logRng.float(0.6, 1.3)),
            // These are materialised derivations of the day's plan/event, not
            // free values — the adherence rails read them directly.
            target_calories: targetCals,
            target_protein_g: proteinG,
            target_carbs_g: isTrainingDay ? Math.round(carbG * 1.2) : carbG,
            target_fat_g: fatG,
            // A STATUS enum (hit/partial/missed), not a 0-100 percentage. The
            // column is plain text with no CHECK, so a number would insert
            // silently as "87" and poison every adherence read.
            nutrition_adherence: nutritionAdherenceStatus(consumed, targetCals),
            calorie_surplus_deficit: consumed - targetCals,
            created_at: timestampAt(iso, nutritionHour(logRng), logRng),
            updated_at: timestampAt(iso, nutritionHour(logRng), logRng),
          });
        }

        for (const h of clientHabits) {
          if (!logRng.bool(0.75)) continue;
          habitLogs.push({
            id: seedUuid("hlog", coachIdx, c, dayIdx, String(h.id)),
            daily_habit_id: h.id,
            client_id: clientId,
            date: iso,
            completed: logRng.bool(0.72),
            created_at: timestampAt(iso, wellnessHour(logRng), logRng),
            updated_at: timestampAt(iso, wellnessHour(logRng), logRng),
          });
        }
      }

      // --- session log + set detail, only for completed training events
      if (eventId && completed) {
        const sessionLogId = seedUuid("slog", coachIdx, c, dayIdx);
        const hour = sessionHour(iso, logRng);
        sessionLogs.push({
          id: sessionLogId,
          client_id: clientId,
          training_session_id: slot!.sessionId,
          // Written in the INITIAL insert — session_logs has a BEFORE UPDATE
          // updated_at trigger, so a second pass would destroy the backdating.
          training_event_id: eventId,
          completed_at: timestampAt(iso, hour, logRng), // attribution date, not entry time
          completion_quality: quality,
          week_start_date: mondayOf(iso),
          notes: logRng.bool(0.18) ? checkInResponse(logRng) : null,
          created_at: timestampAt(iso, hour, logRng),
          updated_at: timestampAt(iso, hour, logRng),
        });
        backLink.set(eventId, sessionLogId);

        // Not every completed session carries set detail — clients routinely
        // mark a session done without logging every set.
        if (logRng.bool(archetype.setDetail)) {
          const exCount = logRng.int(5, 8);
          const chosen = logRng.shuffle(clientExercises).slice(0, exCount);
          chosen.forEach((ex, i) => {
            const exLogId = seedUuid("elog", coachIdx, c, dayIdx, i);
            exerciseLogs.push({
              id: exLogId,
              session_log_id: sessionLogId,
              training_exercise_id: null, // freehand: NULLs are distinct, so no unique clash
              exercise_id: ex.id,
              performed_name: ex.name, // without this the exercise list collapses to 'unknown'
              completed: true,
                      notes: logRng.bool(0.08) ? coachNote(logRng) : null,
              created_at: timestampAt(iso, hour, logRng),
              updated_at: timestampAt(iso, hour, logRng),
            });

            // Progressive overload across the tenure, plus noise, so the
            // progression and PR RPCs have a real signal to find.
            const progress = 1 + 0.18 * (dayIdx / Math.max(tenureDays, 1));
            const setCount = logRng.int(3, 5);
            for (let s = 1; s <= setCount; s++) {
              const isWarmup = s === 1;
              const load = ex.base * progress * logRng.float(0.94, 1.06) * (isWarmup ? 0.55 : 1);
              setLogs.push({
                id: seedUuid("setlog", coachIdx, c, dayIdx, i, s),
                exercise_log_id: exLogId,
                set_number: s, // CHECK >= 1, unique (exercise_log_id, set_number)
                reps: logRng.int(4, 14), // CHECK 1..100
                weight: Math.min(2000, round(load, 1)), // CHECK 0..2000, numeric(7,2)
                rpe: logRng.int(6, 10), // CHECK 1..10
                set_type: isWarmup
                  ? "warmup"
                  : logRng.weighted([["working", 12], ["amrap", 1], ["drop", 1], ["failure", 1]] as const),
                created_at: timestampAt(iso, hour, logRng),
                updated_at: timestampAt(iso, hour, logRng),
              });
            }
          });
        }
      }

      // --- the start reading on day 0 (an intake row: the baseline the
      //     as-of-start-date rule derives), then a coach-logged weight roughly
      //     fortnightly. Every reading is a row in the measurement log —
      //     canonical kg, `value > 0` strictly, metric_key from the CHECK list.
      if (dayIdx === 0) {
        const recordedAt = timestampAt(iso, 7, logRng);
        measurements.push(
          {
            id: seedUuid("measure", coachIdx, c, dayIdx, "weight", "intake"),
            client_id: clientId,
            metric_key: "weight",
            value: startWeight,
            recorded_on: iso,
            recorded_at: recordedAt,
            source: "intake",
            created_at: recordedAt,
          },
          {
            id: seedUuid("measure", coachIdx, c, dayIdx, "bodyFat", "intake"),
            client_id: clientId,
            metric_key: "bodyFat",
            value: startBf,
            recorded_on: iso,
            recorded_at: recordedAt,
            source: "intake",
            created_at: recordedAt,
          }
        );
      }
      if (dayIdx % 14 === 0 && logs) {
        const w = weightAt(dayIdx);
        const recordedAt = timestampAt(iso, 7, logRng);
        measurements.push({
          id: seedUuid("measure", coachIdx, c, dayIdx, "weight", "coach"),
          client_id: clientId,
          metric_key: "weight",
          value: w,
          recorded_on: iso,
          recorded_at: recordedAt,
          source: "coach_entry",
          created_by: coachId,
          created_at: recordedAt,
        });
      }

      // --- check-ins on the client's check-in day.
      //
      // Deliberately under-supplied relative to tenure: the adherence trigger
      // computes expected = FLOOR(age_days / freq_days) from clients.created_at,
      // so writing exactly one per period pins check_in_adherence_rate at 100
      // for every client regardless of backdating.
      if (dayOfWeekName(iso) === checkInDay && dayIdx > 6 && logRng.bool(archetype.checkInRate)) {
        const periodStart = addDays(iso, -6);
        const checkInId = seedUuid("checkin", coachIdx, c, dayIdx);
        const submittedAt = timestampAt(iso, checkInHour(logRng), logRng);
        // What the check-in reported: rows in the measurement log stamped with
        // its id (the check-in row itself owns no measurement columns).
        const reported: Record<string, number> = {
          weight: weightAt(dayIdx),
          bodyFat: round(Math.max(8, startBf - (startWeight - weightAt(dayIdx)) * 0.55), 1),
          waist: round(logRng.gauss(88, 9, 62, 120), 1),
          hips: round(logRng.gauss(98, 9, 70, 130), 1),
          chest: round(logRng.gauss(100, 9, 75, 132), 1),
          arms: round(logRng.gauss(35, 4, 24, 50), 1),
          thighs: round(logRng.gauss(58, 6, 42, 78), 1),
        };
        for (const [metricKey, value] of Object.entries(reported)) {
          measurements.push({
            id: seedUuid("measure", coachIdx, c, dayIdx, metricKey, "checkin"),
            client_id: clientId,
            metric_key: metricKey,
            value,
            recorded_on: iso,
            recorded_at: submittedAt,
            measured_at: submittedAt,
            source: "check_in",
            source_id: checkInId,
            created_at: submittedAt,
          });
        }
        checkIns.push({
          id: checkInId,
          client_id: clientId,
          status: logRng.weighted([["reviewed", 6], ["ai_processed", 2], ["pending", 2]] as const),
          mood: logRng.int(2, 5), // CHECK 1..5 — every sibling scale is 1..10
          energy: logRng.int(3, 9),
          sleep: logRng.int(3, 9),
          stress: logRng.int(2, 8),
          soreness: logRng.int(1, 8),
          notes: checkInResponse(logRng),
          prs: logRng.bool(0.4) ? checkInResponse(logRng) : null,
          challenges: checkInResponse(logRng),
          nutrition_notes: logRng.bool(0.5) ? checkInResponse(logRng) : null,
          // ai_summary is text; ai_insights and ai_recommendations are JSONB.
          // A prose string in a jsonb column inserts cleanly as a string scalar
          // and then hands lib/mappers.ts a string where every reader expects
          // EnhancedAIDataV3 / a CheckInCoachAction[].
          ai_summary: aiReviewText(logRng),
          ai_insights: aiInsightsV3(logRng),
          ai_recommendations: aiRecommendations(logRng),
          coach_response: logRng.bool(0.55) ? coachNote(logRng) : null,
          workouts_completed: logRng.int(0, TRAIN_DAYS_PER_WEEK),
          nutrition_days_on_target: logRng.int(0, 7), // CHECK 0..7
          adherence_percentage: logRng.int(35, 100), // CHECK 0..100
          period_start: periodStart,
          period_end: iso,
          created_at: submittedAt,
          updated_at: submittedAt,
        });
        checkInsWritten++;
      }
    }

    void checkInsWritten;
  }

  // Dependency order. nutrition_events after training_events; the event
  // back-link after session_logs; check_ins dead last because of its two
  // AFTER INSERT triggers.
  push("clients", clients);
  push("client_invitations", invitations);
  push("client_goals", goals);
  push("daily_habits", habits);
  push("training_plans", plans);
  push("training_sessions", sessions);
  push("training_exercises", exercises);
  push("training_events", events);
  push("nutrition_plans", nPlans);
  push("nutrition_plan_daily_targets", nTargets);
  push("nutrition_events", nEvents);
  push("daily_logs", dailyLogs);
  push("wellness_logs", wellness);
  push("nutrition_logs", nutritionLogs);
  push("daily_habit_logs", habitLogs);
  push("session_logs", sessionLogs);
  // The back-link half of the training_events <-> session_logs cycle. Re-emits
  // the FULL event row rather than {id, session_log_id}: a partial upsert leaves
  // it ambiguous which columns a conflicting row keeps. Safe to rewrite because
  // training_events is one of the six tables with no updated_at trigger, so the
  // explicit created_at/updated_at survive.
  push(
    "training_events",
    Array.from(backLink, ([eventId, sessionLogId]) => ({
      ...(eventRowById.get(eventId) as Record<string, unknown>),
      session_log_id: sessionLogId,
    })),
    "upsert",
    "id"
  );
  push("exercise_logs", exerciseLogs);
  push("set_logs", setLogs);
  // The measurement log is INSERT-only for the app role (migration 158), so
  // these rows are never deleted by teardown: they go with their client's row
  // through ON DELETE CASCADE.
  push("client_measurements", measurements);
  push("check_ins", checkIns);

  return steps;
}

/** Fallback catalogue when the live `exercises` table is empty (fresh local DB). */
export function fallbackCatalog(): CatalogExercise[] {
  return EXERCISE_POOL.map((e) => ({ id: null, name: e.name, compound: e.compound, base: e.base }));
}

export { ARCHETYPES, BLOCK_DAYS, BLOCKS_PER_CLIENT, TRAIN_DAYS_PER_WEEK };
export type { Archetype };
