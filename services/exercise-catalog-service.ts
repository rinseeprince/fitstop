import { supabaseAdmin } from "./supabase-admin";
import type { Exercise } from "@/types/training";
import type { ExerciseRow } from "@/lib/database-helpers";

// --- Abbreviation map ---

const ABBREVIATIONS: Record<string, string> = {
  db: "dumbbell",
  bb: "barbell",
  ohp: "overhead press",
  rdl: "romanian deadlift",
  cgbp: "close grip bench press",
  sldl: "stiff leg deadlift",
  ez: "ez-bar",
  kb: "kettlebell",
  bw: "bodyweight",
};

// --- Row mapper ---

function mapExerciseCatalogRow(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    category: row.category,
    aliases: row.aliases ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Helpers ---

/**
 * Applies abbreviation map to each word, lowercases.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(" ");
}

/**
 * Try to find an exercise by matching a value against names or aliases.
 * Coach-specific exercises take precedence over global.
 */
function findMatch(
  exercises: ExerciseRow[],
  normalized: string
): ExerciseRow | undefined {
  // Exact name match (coach-specific first due to sort order)
  const nameMatch = exercises.find(
    (e) => e.name.toLowerCase() === normalized
  );
  if (nameMatch) return nameMatch;

  // Alias match
  const aliasMatch = exercises.find((e) =>
    (e.aliases ?? []).some((a) => a.toLowerCase() === normalized)
  );
  return aliasMatch;
}

// --- Public API ---

/**
 * Resolve a single exercise name to an exercise ID.
 * Pipeline: exact match → alias match → abbreviation-normalize & retry → create new.
 */
export async function resolveExercise(
  name: string,
  coachId: string
): Promise<string> {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const normalized = normalizeExerciseName(trimmed);

  // Fetch all exercises for this coach + global, ordered coach-first
  const { data: exercises, error } = await supabaseAdmin
    .from("exercises")
    .select("*")
    .or(`coach_id.eq.${coachId},coach_id.is.null`)
    .order("coach_id", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to fetch exercises: ${error.message}`);

  const rows = exercises ?? [];

  // Step 1: Exact name match
  const exactMatch = findMatch(rows, lower);
  if (exactMatch) return exactMatch.id;

  // Step 2: Abbreviation-normalized match (only if different from original)
  if (normalized !== lower) {
    const normalizedMatch = findMatch(rows, normalized);
    if (normalizedMatch) return normalizedMatch.id;
  }

  // Step 3: No match — create new coach-specific exercise
  const { data: newExercise, error: insertError } = await supabaseAdmin
    .from("exercises")
    .insert({ coach_id: coachId, name: trimmed })
    .select()
    .single();

  if (insertError)
    throw new Error(`Failed to create exercise: ${insertError.message}`);

  return newExercise.id;
}

/**
 * Batch resolve multiple exercise names to exercise IDs.
 * Fetches all coach + global exercises in one query, matches in memory,
 * batch-inserts missing ones.
 * Returns Map<originalName, exerciseId>.
 */
export async function resolveExercises(
  names: string[],
  coachId: string
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();

  // Deduplicate input names (preserve original casing for first occurrence)
  const uniqueMap = new Map<string, string>(); // lower → original
  for (const name of names) {
    const lower = name.trim().toLowerCase();
    if (!uniqueMap.has(lower)) {
      uniqueMap.set(lower, name.trim());
    }
  }

  // Fetch all exercises for this coach + global
  const { data: exercises, error } = await supabaseAdmin
    .from("exercises")
    .select("*")
    .or(`coach_id.eq.${coachId},coach_id.is.null`)
    .order("coach_id", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to fetch exercises: ${error.message}`);

  const rows = exercises ?? [];
  const result = new Map<string, string>(); // originalName → exerciseId
  const toCreate: Array<{ name: string; lower: string }> = [];

  for (const [lower, original] of uniqueMap) {
    const normalized = normalizeExerciseName(original);

    // Try exact match
    let match = findMatch(rows, lower);

    // Try abbreviation-normalized match
    if (!match && normalized !== lower) {
      match = findMatch(rows, normalized);
    }

    if (match) {
      result.set(original, match.id);
    } else {
      toCreate.push({ name: original, lower });
    }
  }

  // Batch insert missing exercises
  if (toCreate.length > 0) {
    const inserts = toCreate.map((e) => ({
      coach_id: coachId,
      name: e.name,
    }));

    const { data: newExercises, error: insertError } = await supabaseAdmin
      .from("exercises")
      .insert(inserts)
      .select();

    if (insertError)
      throw new Error(`Failed to create exercises: ${insertError.message}`);

    for (const row of newExercises ?? []) {
      const lower = row.name.toLowerCase();
      const original = uniqueMap.get(lower);
      if (original) {
        result.set(original, row.id);
      }
    }
  }

  // Map all original names (including duplicates) to their exercise IDs.
  // Keys are set in BOTH trimmed-original and lowercase forms: consumers are
  // split between .get(name.trim()) (training-session-service, overwrite)
  // and .get(name.trim().toLowerCase()) (insertSavedExercises,
  // addSavedExercise) — a single-cased map silently returned undefined for
  // one side, storing exercise_id NULL for mixed-case names and making those
  // rows invisible to usage counts.
  const fullResult = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    const original = uniqueMap.get(lower);
    if (original && result.has(original)) {
      const id = result.get(original)!;
      fullResult.set(trimmed, id);
      fullResult.set(lower, id);
    }
  }

  return fullResult;
}

/**
 * Returns all exercises visible to the coach (global + coach-specific),
 * optionally filtered by search term. Ordered alphabetically.
 */
export async function getExercisesForCoach(
  coachId: string,
  search?: string
): Promise<Exercise[]> {
  let query = supabaseAdmin
    .from("exercises")
    .select("*")
    .or(`coach_id.eq.${coachId},coach_id.is.null`)
    .order("name", { ascending: true });

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch exercises: ${error.message}`);

  return (data ?? []).map(mapExerciseCatalogRow);
}

// --- Catalog delta-sync (Session 3.9) ---

// Lean, sparse fieldset for the native client's incremental catalog sync —
// only the columns the client renderer needs (NOT SELECT *). updated_at is the
// delta cursor.
export type ExerciseCatalogDeltaRow = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  updated_at: string;
};

// PostgREST caps a single response at ~1000 rows, so the catalog read pages
// internally to this size and concatenates until a short page signals the end.
const CATALOG_PAGE_SIZE = 1000;

/**
 * Delta-sync feed for the exercise catalog visible to a coach (global +
 * coach-specific), ordered by (updated_at, id) ASC. When `since` is provided,
 * returns only rows changed strictly after it (`updated_at > since`), so the
 * native client fetches just what changed since its last sync watermark.
 *
 * COMPLETE BY CONSTRUCTION: a catalog larger than PostgREST's ~1000-row cap
 * (globals can exceed it) would silently truncate a full sync, so we page
 * internally on a tie-safe keyset cursor `(updated_at, id)` and concatenate —
 * the returned delta is always complete regardless of size. The `id` tiebreak is
 * REQUIRED, not cosmetic: the catalog is seeded in batches that share an
 * `updated_at`, and paging on `updated_at` alone would either skip tied rows
 * (strict `>`) or loop forever (`>=`).
 *
 * The "no skips, no repeats" guarantee is for a STATIC snapshot. Because the
 * sort key mutates (the migration-096 trigger bumps `updated_at` to NOW() on
 * UPDATE), a row edited *between* page round-trips during a large full sync can
 * re-enter the keyset window and appear twice — never skipped, only repeated.
 * The ID-first client upsert makes that idempotent, so it is harmless.
 *
 * UPSERT-ONLY: hard-deletes and coach_id scope-changes are invisible to a delta;
 * the client reconciles those via a periodic FULL resync (omit `since`). See
 * docs/CLIENT-PORTAL-REDESIGN.md (ID-first rows + catalog delta-sync).
 *
 * Same trust model as getExercisesForCoach: the `.or()` union is interpolated
 * with a coachId resolved server-side from the authed session, and `since` must
 * be validated upstream (isValidIsoTimestamp) before reaching this query.
 */
export async function getExerciseCatalogDelta(
  coachId: string,
  since?: string,
): Promise<ExerciseCatalogDeltaRow[]> {
  const out: ExerciseCatalogDeltaRow[] = [];
  let cursor: { updatedAt: string; id: string } | null = null;

  for (;;) {
    let query = supabaseAdmin
      .from("exercises")
      .select("id, name, muscle_group, equipment, updated_at")
      .or(`coach_id.eq.${coachId},coach_id.is.null`)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(CATALOG_PAGE_SIZE);

    if (cursor) {
      // Subsequent pages: strict keyset advance on (updated_at, id) so rows that
      // share an `updated_at` are paged without skips or repeats. (Page-2 rows
      // are necessarily still `> since` too, since the page-1 tail was.)
      query = query.or(
        `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`,
      );
    } else if (since) {
      // First page: preserve delta semantics — strictly newer than the watermark.
      query = query.gt("updated_at", since);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch exercise catalog: ${error.message}`);

    const rows = (data ?? []) as ExerciseCatalogDeltaRow[];
    out.push(...rows);

    if (rows.length < CATALOG_PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    cursor = { updatedAt: last.updated_at, id: last.id };
  }

  return out;
}

/**
 * Usage counts for the Exercises library: distinct saved sessions per
 * catalog exercise, scoped to the coach via the session join. Rows with
 * exercise_id NULL (free-text prescriptions that never resolved) are
 * invisible here by definition. Pages through PostgREST's row cap — this
 * table genuinely can exceed it.
 */
export async function getExerciseUsageForCoach(coachId: string): Promise<{
  perExercise: Array<{ exerciseId: string; sessionCount: number }>;
  sessionsWithLinks: number;
}> {
  const PAGE = 1000;
  const rows: Array<{ exercise_id: string | null; saved_session_id: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("coach_saved_exercises")
      .select("exercise_id, saved_session_id, coach_saved_sessions!inner(coach_id)")
      .eq("coach_saved_sessions.coach_id", coachId)
      .not("exercise_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to fetch exercise usage: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const perExerciseSessions = new Map<string, Set<string>>();
  const allSessions = new Set<string>();
  for (const row of rows) {
    if (!row.exercise_id) continue;
    let set = perExerciseSessions.get(row.exercise_id);
    if (!set) {
      set = new Set();
      perExerciseSessions.set(row.exercise_id, set);
    }
    set.add(row.saved_session_id);
    allSessions.add(row.saved_session_id);
  }

  return {
    perExercise: [...perExerciseSessions.entries()].map(
      ([exerciseId, sessions]) => ({
        exerciseId,
        sessionCount: sessions.size,
      })
    ),
    sessionsWithLinks: allSessions.size,
  };
}

/**
 * Update a COACH-OWNED catalog exercise. Global rows (coach_id NULL) never
 * match the coach_id filter, so they are un-editable by construction.
 */
export async function updateCatalogExercise(
  exerciseId: string,
  coachId: string,
  updates: {
    name?: string;
    muscleGroup?: string | null;
    equipment?: string | null;
    category?: string | null;
    aliases?: string[];
  }
): Promise<Exercise> {
  const { data, error } = await supabaseAdmin
    .from("exercises")
    .update({
      ...(updates.name !== undefined && { name: updates.name.trim() }),
      ...(updates.muscleGroup !== undefined && { muscle_group: updates.muscleGroup }),
      ...(updates.equipment !== undefined && { equipment: updates.equipment }),
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.aliases !== undefined && { aliases: updates.aliases }),
    })
    .eq("id", exerciseId)
    .eq("coach_id", coachId)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Failed to update exercise: ${error.message}`);
  if (!data) throw new Error("Exercise not found");
  return mapExerciseCatalogRow(data);
}

/**
 * Delete a COACH-OWNED catalog exercise. Safe by FK design: both
 * coach_saved_exercises.exercise_id (mig 084) and
 * training_exercises.exercise_id (mig 083) are ON DELETE SET NULL, so
 * prescriptions keep their name and merely lose the catalog link.
 */
export async function deleteCatalogExercise(
  exerciseId: string,
  coachId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("exercises")
    .delete()
    .eq("id", exerciseId)
    .eq("coach_id", coachId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Failed to delete exercise: ${error.message}`);
  if (!data) throw new Error("Exercise not found");
}

/**
 * Creates a coach-specific exercise.
 */
export async function createExercise(
  coachId: string,
  data: {
    name: string;
    muscleGroup?: string;
    equipment?: string;
    category?: string;
    aliases?: string[];
  }
): Promise<Exercise> {
  const { data: row, error } = await supabaseAdmin
    .from("exercises")
    .insert({
      coach_id: coachId,
      name: data.name,
      muscle_group: data.muscleGroup ?? null,
      equipment: data.equipment ?? null,
      category: data.category ?? null,
      aliases: data.aliases ?? [],
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create exercise: ${error.message}`);

  return mapExerciseCatalogRow(row);
}
