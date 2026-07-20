import type { SetSpec } from "@/utils/exercise-set-specs";
import type { SavedPlanStatus } from "@/types/training";

// In-memory draft tree for the full-page Program builder (builder S2.5). The
// coach edits this working copy; nothing persists until "Save program"
// serializes the WHOLE tree via program-builder-serialize.ts (overwrite is
// delete-and-reinsert server-side, so server row ids never survive a save —
// `uid`s below are client-only identity for React keys + dnd).

export type BuilderTarget = "library" | "client-draft";

export const DAYS_PER_WEEK = 7;

// Zod caps weekIndex at 52 INCLUSIVE, which would allow 53 weeks — the builder
// caps at 52 weeks (last weekIndex 51).
export const MAX_WEEKS = 52;

export type ExerciseDraft = {
  uid: string;
  exerciseId: string | null;
  name: string;
  // Per-set list. Stays null for compact-only exercises until the coach's
  // first per-set edit materializes expandSetSpecs(...) — an empty array must
  // NEVER survive normalization (it fails the ≥1-non-warmup zod refine and
  // would 400 the whole save); deleting the last set reverts to null.
  setSpecs: SetSpec[] | null;
  // Compact projection — display + serializer fallback. Whenever setSpecs is
  // non-null these are re-derived via compactFromSpecs (use-set-spec-mutations)
  // so the collapsed summary and legacy readers never drift from the specs.
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget: string | null;
  rpeTarget: number | null;
  percentage1rm: number | null;
  tempo: string | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  isWarmup: boolean;
  notes: string | null;
  videoUrl: string | null;
};

export type SessionDraft = {
  uid: string;
  name: string;
  focus: string | null;
  estimatedDurationMinutes: number | null;
  // Per-session calorie surplus override; null = inherit the program default.
  // Cascades to training_events at apply time — dropping it silently reverts
  // the client's nutrition to rest-day calories.
  calorieSurplusPercentage: number | null;
  notes: string | null;
  sessionType: string;
  exercises: ExerciseDraft[];
};

// One positional day slot (Day 1–7, never weekdays). `session` is singular by
// design — the two-a-days seam is `session: SessionDraft | null` becoming
// `sessions: SessionDraft[]`; keep every consumer on slot-level helpers so
// that flip stays mechanical. A slot with session === null IS a rest day:
// empty === rest, there is no third state. Slots themselves never move — drag
// operations move/swap the `session` payloads between slots.
export type DaySlotDraft = {
  uid: string;
  // Mirrors the slot's array position (0–6); normalizeDraft keeps it in sync.
  orderIndex: number;
  isRest: boolean;
  session: SessionDraft | null;
};

export type WeekDraft = {
  uid: string;
  // Mirrors the week's array position; normalizeDraft keeps it in sync.
  weekIndex: number;
  // Always exactly DAYS_PER_WEEK entries — the placement date-walk relies on
  // every week being 7 materialized slots (a missing slot slides every later
  // date of the placed program).
  days: DaySlotDraft[];
};

export type ProgramDraft = {
  id: string; // savedPlanId
  name: string;
  description: string | null;
  status: SavedPlanStatus;
  // Free-text program focus (stored in the split_type column, e.g. "Push/Pull"
  // or "Glute hypertrophy"). Editable in the header; NOT the strict enum.
  splitType: string | null;
  programDurationWeeks: number | null; // kept accurate via post-save PATCH
  // Program-level default surplus; used wherever a session leaves its own
  // surplus null. Must survive Save program (round-trip tested).
  defaultSurplusPercentage: number | null;
  weeks: WeekDraft[]; // min length 1
};

export function newUid(prefix: "wk" | "slot" | "sess" | "ex"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function makeRestSlot(orderIndex: number): DaySlotDraft {
  return { uid: newUid("slot"), orderIndex, isRest: true, session: null };
}

export function makeRestWeek(weekIndex: number): WeekDraft {
  return {
    uid: newUid("wk"),
    weekIndex,
    days: Array.from({ length: DAYS_PER_WEEK }, (_, i) => makeRestSlot(i)),
  };
}
