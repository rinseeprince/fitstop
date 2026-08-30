/**
 * The shape of a check-in form: which built-in fields it asks, which wizard
 * steps that implies, and how to strip a submission down to it.
 *
 * PURE, and it must stay pure — the client wizard imports it in the browser,
 * so it must never reach `supabaseAdmin` (`npm run check:service-key` fails on
 * a module reachable from `services/supabase-admin.ts` by value import).
 *
 * **Fourteen keys, and that is the complete set of fields the client fills
 * in.** `mood` / `energy` / `sleep` / `stress` / `soreness` are absent because
 * they are not collected: Session 6.4 removed the pickers and sliders, and
 * `submitCheckIn` derives all five from `wellness_logs` over the period (the
 * slots on `submitCheckInSchema` are vestigial wire fields the server ignores).
 * The Feeling step's weekly summary and the Training step's session checklist
 * are read-only viewers of the client's own week — and the checklist is a
 * fill-gap LOGGER writing to `training_events` — so they are not questions and
 * carry no key. Making those two suppressible is a different feature; it is
 * recorded in `TECHNICAL-DEBT.md`, not built.
 */

// Not exported: C6a has no caller outside `stepsForFields`, and the wizard
// (C6b) is what needs the list and its labels. Exporting it now would be an
// unused export the knip gate exists to catch.
const CHECK_IN_FORM_STEPS = [
  "feeling",
  "metrics",
  "photos",
  "training",
] as const;

type CheckInFormStep = (typeof CHECK_IN_FORM_STEPS)[number];

/**
 * Every built-in field, in the order the coach sees it, with the wizard step
 * it lives on. `key` is the storage spelling (`check_in_form_fields.field_key`,
 * CHECK-constrained to exactly these 14 in migration 157 — adding one means a
 * new CHECK value AND an entry here). `label` is coach-facing plain language
 * (CONVENTIONS §2 "Naming for the audience").
 */
export const CHECK_IN_FORM_FIELDS = [
  { key: "notes", label: "Reflection", step: "feeling" },
  { key: "weight", label: "Weight", step: "metrics" },
  { key: "body_fat", label: "Body fat", step: "metrics" },
  { key: "waist", label: "Waist", step: "metrics" },
  { key: "hips", label: "Hips", step: "metrics" },
  { key: "chest", label: "Chest", step: "metrics" },
  { key: "arms", label: "Arms", step: "metrics" },
  { key: "thighs", label: "Thighs", step: "metrics" },
  { key: "photo_front", label: "Front photo", step: "photos" },
  { key: "photo_side", label: "Side photo", step: "photos" },
  { key: "photo_back", label: "Back photo", step: "photos" },
  { key: "exercise_highlights", label: "Exercise highlights", step: "training" },
  { key: "prs", label: "Wins", step: "training" },
  { key: "challenges", label: "Challenges", step: "training" },
] as const satisfies readonly { key: string; label: string; step: CheckInFormStep }[];

export type CheckInFormFieldKey = (typeof CHECK_IN_FORM_FIELDS)[number]["key"];

export const CHECK_IN_FORM_FIELD_KEYS: readonly CheckInFormFieldKey[] =
  CHECK_IN_FORM_FIELDS.map((f) => f.key);

/**
 * What a client with NO form row gets: everything. This is the whole
 * backward-compatibility story — no backfill exists, and none is needed,
 * because absence resolves to the full form.
 */
export const DEFAULT_CHECK_IN_FORM_FIELDS: readonly CheckInFormFieldKey[] =
  CHECK_IN_FORM_FIELDS.map((f) => f.key);

export function isCheckInFormFieldKey(value: string): value is CheckInFormFieldKey {
  return (CHECK_IN_FORM_FIELD_KEYS as readonly string[]).includes(value);
}

/** The resolved form a submission is shaped against. */
type CheckInFormResolution = {
  /** Enabled field keys. Already resolved — never null, never partial. */
  fields: readonly string[];
  /** Enabled, unarchived question ids, in position order. */
  questionIds: readonly string[];
};

/**
 * Which wizard steps a form implies, in order.
 *
 * Feeling and Training are UNCONDITIONAL: their content is the client's own
 * week read back to them (the wellness summary; the session checklist and
 * nutrition summary), which no field key switches. With every key off the
 * client still gets a two-step "here is your week, confirm it" check-in with
 * no text inputs — a reasonable minimum, not a gap.
 */
export function stepsForFields(
  fields: readonly string[]
): CheckInFormStep[] {
  const enabled = new Set(fields);
  const hasStep = (step: CheckInFormStep) =>
    CHECK_IN_FORM_FIELDS.some((f) => f.step === step && enabled.has(f.key));

  return CHECK_IN_FORM_STEPS.filter(
    (step) => step === "feeling" || step === "training" || hasStep(step)
  );
}

/** The unit-tagged, strippable slice of a check-in submission. */
type CheckInStrippablePayload = {
  notes?: string;
  weight?: number;
  weightUnit?: "lbs" | "kg";
  bodyFatPercentage?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;
  measurementUnit?: "in" | "cm";
  photoFront?: string;
  photoSide?: string;
  photoBack?: string;
  exerciseHighlights?: unknown[];
  prs?: string;
  challenges?: string;
  customAnswers?: { questionId: string; answer: string }[];
};

/**
 * Strip a submission down to what the form actually asks.
 *
 * **Strip, never 400** (D4.3). A payload carrying a disabled field is not a
 * misbehaving client — it is a client who loaded the form, or restored a
 * localStorage draft, before the coach changed it. Rejecting punishes them for
 * someone else's edit; dropping the value is the honest answer.
 *
 * A unit tag goes with the last value it describes: leaving `weightUnit` on a
 * payload whose weight has been stripped states a unit for nothing.
 *
 * Custom answers are filtered to the ENABLED question set, blank answers are
 * dropped (the column CHECKs `char_length >= 1`), and duplicates collapse to
 * the first — `check_in_answers` is UNIQUE per (check-in, question), so a
 * repeated id would 23505 the insert.
 */
export function applyCheckInForm<T extends CheckInStrippablePayload>(
  payload: T,
  form: CheckInFormResolution
): T {
  const enabled = new Set(form.fields);
  const keep = <V>(key: CheckInFormFieldKey, value: V): V | undefined =>
    enabled.has(key) ? value : undefined;

  const weight = keep("weight", payload.weight);
  const waist = keep("waist", payload.waist);
  const hips = keep("hips", payload.hips);
  const chest = keep("chest", payload.chest);
  const arms = keep("arms", payload.arms);
  const thighs = keep("thighs", payload.thighs);
  const hasGirth = [waist, hips, chest, arms, thighs].some((v) => v !== undefined);

  const allowed = new Set(form.questionIds);
  const seen = new Set<string>();
  const rawAnswers = Array.isArray(payload.customAnswers) ? payload.customAnswers : [];
  const customAnswers = rawAnswers.filter((entry) => {
    if (!entry || typeof entry.questionId !== "string") return false;
    if (!allowed.has(entry.questionId) || seen.has(entry.questionId)) return false;
    if (typeof entry.answer !== "string" || entry.answer.trim() === "") return false;
    seen.add(entry.questionId);
    return true;
  });

  return {
    ...payload,
    notes: keep("notes", payload.notes),
    weight,
    weightUnit: weight !== undefined ? payload.weightUnit : undefined,
    bodyFatPercentage: keep("body_fat", payload.bodyFatPercentage),
    waist,
    hips,
    chest,
    arms,
    thighs,
    measurementUnit: hasGirth ? payload.measurementUnit : undefined,
    photoFront: keep("photo_front", payload.photoFront),
    photoSide: keep("photo_side", payload.photoSide),
    photoBack: keep("photo_back", payload.photoBack),
    exerciseHighlights: keep("exercise_highlights", payload.exerciseHighlights),
    prs: keep("prs", payload.prs),
    challenges: keep("challenges", payload.challenges),
    customAnswers,
  };
}
