/**
 * Application-wide constants
 * Extracted from various files to centralize magic numbers
 */

// Type-only: erased at compile, so this file stays a runtime leaf.
import type { ActivityLevel, CheckInStatus } from "@/types/check-in";

// Days past the expected check-in date at which "overdue" becomes
// "critically overdue". Read by getOverdueSeverity and by the Clients roster's
// stat band, which used to restate the boundary as its own literal.
export const CRITICALLY_OVERDUE_DAYS = 4;

// How long a due check-in stays satisfiable before it lapses and the next one
// becomes live. Until the due date was stored this window existed only as a
// side effect — the derived period snapped forward and the missed week was
// silently never filled. Read by resolveCheckInDue (lib/check-in-schedule.ts).
export const CHECK_IN_GRACE_DAYS = 7;

// Every check_ins.status value, in lifecycle order (pending → ai_processed →
// reviewed). The coach per-client list validates its ?status= filter against
// this rather than restating the lifecycle as a literal of its own.
export const CHECK_IN_STATUSES = [
  "pending",
  "ai_processed",
  "reviewed",
] as const satisfies readonly CheckInStatus[];

// "Unreviewed" for every coach queue: the Overview's awaiting-review row,
// /api/check-ins/unreviewed (the bell and the toast listener) and the
// promotion guard in updateCheckInAISummary. It INCLUDES `pending` (owner
// decision D2.2, 2026-08-29): a submitted check-in whose AI pass failed must
// still reach a coach — the review surface offers Regenerate for a pending
// row — and three predicates used to spell this differently, so the queues
// disagreed about who was waiting.
export const UNREVIEWED_CHECK_IN_STATUSES = [
  "pending",
  "ai_processed",
] as const satisfies readonly CheckInStatus[];

// Custom macros validation
export const CUSTOM_MACRO_CALORIE_TOLERANCE = 50; // Max allowed difference between stated calories and macro totals

// Energy density of one kilogram of body-mass change, in kcal. The single
// source for every rate <-> calorie conversion (utils/energy-conversions.ts);
// it previously lived as an inline 7700 at three calculator sites and a
// per-render hook local, which is exactly the drift §3 forbids.
export const CALORIES_PER_KG = 7700;

// Nutrition adherence thresholds
export const NUTRITION_ADHERENCE_HIT_THRESHOLD = 50; // Within 50 calories = "hit"
export const NUTRITION_ADHERENCE_PARTIAL_THRESHOLD = 200; // Within 200 calories = "partial"

// Weekly nutrition adherence thresholds (per day, scaled by days_in_week)
// 7-day week: hit <= 350 cal, partial <= 1001 cal, missed > 1001 cal
export const WEEKLY_NUTRITION_HIT_PER_DAY = 50;
export const WEEKLY_NUTRITION_PARTIAL_PER_DAY = 143;

// Sanity bounds for stored body measurements and loads.
//
// Storage is canonical: every weight is KILOGRAMS and every length is
// CENTIMETRES (CONVENTIONS.md §20 Units). These bounds describe
// STORAGE, so a form collecting in the viewer's unit converts first and
// validates the converted value — never the number that was typed.
//
// They live here because the same ceiling was written out at six separate
// sites, three of which were pounds-shaped (20-700) sitting on kg columns and
// accepting 699 kg, while a fourth narrowed the same quantity to 20-250 kg
// inline in a route handler. CONVENTIONS §3: a threshold that appears twice
// belongs in one place.
export const WEIGHT_KG_MIN = 20;
export const WEIGHT_KG_MAX = 250; // ~550 lb — above any plausible client

// Girths: waist/hips/chest run larger than arms/thighs, hence two bounds. The
// VALUES are unchanged from what each site already used — they were unit-blind
// (one range serving both inches and centimetres), not wrong for centimetres.
export const GIRTH_TORSO_CM_MAX = 200;
export const GIRTH_LIMB_CM_MAX = 100;

// A logged or reported training load, in kilograms. Deliberately generous and
// deliberately UNCHANGED from the 2000 each site already used: a plate-loaded
// leg press legitimately exceeds any bound a barbell would suggest, so this is
// a nonsense-catcher, not a business rule.
//
// NOT for `setSpecSchema.load_value` (lib/validations/training.ts), which
// shares one bound across two quantities — an absolute kg load when load_type
// is "absolute", a PERCENTAGE when it is pct_1rm/pct_top. Naming that bound
// "KG" would assert something false about half its values, so it keeps its
// literal. Do not "unify" it.
export const LOAD_KG_MAX = 2000;

// Journey blocks (client_phases). BLOCK_WEEKS_MAX deliberately MIRRORS the
// program builder's MAX_WEEKS (components/clients/training/program-builder/
// program-builder-types.ts) rather than importing it: lib must not depend on
// components/, and the two bound different things — an authored program's
// length vs one journey block's. Drift is tolerated but must be deliberate;
// if you change one, decide about the other on purpose.
/** How many superseded goal versions the history read returns. `getGoalsHistory`
 *  had no limit at all, so a heavily-edited client returned every version ever
 *  written; the list it feeds is a "what did I change" reference, not an audit
 *  log, and nobody scrolls twenty of them. */
export const GOAL_HISTORY_LIMIT = 20;

export const BLOCK_WEEKS_MAX = 52;
export const BLOCKS_PER_CLIENT_MAX = 20;
export const BLOCK_NAME_MAX = 80;
export const BLOCK_FOCUS_MAX = 500;

// Pagination
export const CLIENT_CHECKINS_PAGE_SIZE = 20; // "Load older" page size for the coach per-client check-ins tab

// Trigger thresholds for attention alerts
export const MOOD_ENERGY_DROP_THRESHOLD = 2; // Points below average
export const MOOD_ENERGY_DROP_CONSECUTIVE_DAYS = 3;
export const MOOD_ENERGY_ROLLING_DAYS = 7;

export const LOGGING_GAP_THRESHOLD_DAYS = 3;

export const NUTRITION_MISSED_CONSECUTIVE_DAYS = 3;

export const TRAINING_MISSED_WEEKLY_THRESHOLD = 2; // Sessions per week
export const PARTIAL_TRAINING_LOOKBACK_EVENTS = 9;
export const PARTIAL_TRAINING_THRESHOLD = 3;

// No-engagement (disengaged-client) thresholds
export const NO_ENGAGEMENT_SILENCE_DAYS = 3; // No activity (logs/habits/completed sessions) in this many days
export const NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS = 3; // Days after start_date before a silent client is flagged

export const HIGH_STRESS_THRESHOLD = 8; // Stress level
export const HIGH_STRESS_CONSECUTIVE_DAYS = 3;

export const HIGH_SORENESS_THRESHOLD = 8; // Soreness level
export const HIGH_SORENESS_CONSECUTIVE_DAYS = 3;

export const HABIT_DROPOFF_THRESHOLD_PERCENT = 50; // Completion rate %
export const HABIT_DROPOFF_DAYS_IN_WEEK = 5; // Days out of 7

export const ACTIVITY_CAL_MISMATCH_DAY_COUNT = 2; // Days in 28-day window
export const ACTIVITY_CAL_MISMATCH_WINDOW_DAYS = 28;

// Audit log action keys (see services/audit-log-service.ts + migration 108).
// Dotted "<entity>.<verb>" convention. Add new keys here as more mutation routes
// are instrumented.
export const AUDIT_ACTIONS = {
  CLIENT_ACTIVATE: "client.activate",
  GOAL_CREATE: "goal.create",
  MEASUREMENT_CREATE: "measurement.create",
  MEASUREMENT_UPDATE: "measurement.update",
  MEASUREMENT_VOID: "measurement.void",
  MEASUREMENT_RESTORE: "measurement.restore",
  METRIC_ENTRY_UPSERT: "metric_entry.upsert",
  INTAKE_SYNC_METRICS: "intake.sync_metrics",
  NUTRITION_PLAN_CREATE: "nutrition_plan.create",
  NUTRITION_PLAN_DELETE: "nutrition_plan.delete",
  TRAINING_PLAN_PLACE: "training_plan.place",
  TRAINING_PLAN_CREATE: "training_plan.create",
  TRAINING_PLAN_AMEND: "training_plan.amend",
  INVITATION_SEND: "invitation.send",
  BLOCK_CHAIN_UPDATE: "block.chain_update",
  BLOCK_DELETE: "block.delete",
  BLOCK_ARCHIVE: "block.archive",
  CHECK_IN_FORM_UPDATE: "check_in_form.update",
  CHECK_IN_FORM_TEMPLATE_CREATE: "check_in_form_template.create",
} as const;

/**
 * How many custom questions one check-in form may ask.
 *
 * ONE definition, because it bounds two different things that must agree: the
 * form the coach saves (`saveCheckInFormSchema`) and the answers the client
 * sends back (`submitCheckInSchema.customAnswers`). A form allowed more
 * questions than a submission may carry answers would silently drop the tail.
 */
export const MAX_CHECK_IN_QUESTIONS = 10;

// Client energy (BMR/TDEE) — see services/client-energy-calc.ts.
// The activity fallback mirrors the column DEFAULT (migration 046) so a NULL
// row and a freshly-inserted row agree on what "unset" costs.
export const DEFAULT_WORK_ACTIVITY_LEVEL: ActivityLevel = "sedentary";
// Mifflin-St Jeor needs an age. This was a silent `?? 30` inside the BMR
// helper; named so it is auditable and so a UI nudge has something to cite.
export const DEFAULT_BMR_AGE_YEARS = 30;