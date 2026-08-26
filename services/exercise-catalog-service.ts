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

/**
 * Offset paging across separate PostgREST requests has no cross-page
 * snapshot: a row inserted between round trips shifts every later offset,
 * re-returning a page boundary row. Dedupe by id so a rare race never
 * surfaces a doubled row (a skipped row self-heals on the next fetch).
 */
function dedupeRowsById(rows: ExerciseRow[]): ExerciseRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/**
 * Full coach+global catalog rows for name resolution, ordered coach-first so
 * coach-specific rows win ties in findMatch. Pages past PostgREST's
 * ~1000-row response cap — an unpaged read hid the tail of the union from
 * the resolver, so saves silently re-created exercises that already existed
 * (duplicate coach customs, split usage counts). The `id` tiebreak keeps
 * offset paging stable within the coach/global groups.
 */
export async function fetchCatalogRowsForResolve(
  coachId: string
): Promise<ExerciseRow[]> {
  const PAGE = 1000;
  const rows: ExerciseRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .select("*")
      .or(`coach_id.eq.${coachId},coach_id.is.null`)
      .order("coach_id", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Failed to fetch exercises: ${error.message}`);

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return dedupeRowsById(rows);
}

// --- Public API ---

/**
 * READ-ONLY resolution over pre-fetched catalog rows — the AI assistant's
 * matcher (builder S6a / the Phase-6 catalog constraint). Same pipeline as
 * resolveExercise (exact name → alias → abbreviation-normalized retry) but
 * NEVER creates a row on a miss: the assistant must repair or ask, not mint
 * coach-specific catalog entries. The shared resolveExercises create-on-miss
 * default is deliberately untouched (manual/overwrite/standalone save paths
 * depend on it).
 */
export function matchExerciseInRows(
  rows: ExerciseRow[],
  name: string
): ExerciseRow | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const exact = findMatch(rows, lower);
  if (exact) return exact;
  const normalized = normalizeExerciseName(name);
  if (normalized !== lower) {
    const normalizedMatch = findMatch(rows, normalized);
    if (normalizedMatch) return normalizedMatch;
  }
  return null;
}

/**
 * Best-effort repair candidates for an unresolved name — surfaced to the
 * assistant so it can pick a real catalog exercise or ask the coach. Scored by
 * simple containment over the normalized name + aliases; deterministic order.
 */
export function suggestExerciseCandidates(
  rows: ExerciseRow[],
  name: string,
  limit = 5
): Array<{ id: string; name: string }> {
  const normalized = normalizeExerciseName(name);
  const words = normalized.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];

  const scored: Array<{ id: string; name: string; score: number }> = [];
  for (const row of rows) {
    const haystacks = [row.name, ...(row.aliases ?? [])].map((h) =>
      h.toLowerCase()
    );
    let score = 0;
    for (const word of words) {
      if (haystacks.some((h) => h.includes(word))) score += 1;
    }
    if (haystacks.some((h) => h === normalized)) score += words.length;
    if (score > 0) scored.push({ id: row.id, name: row.name, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ id, name: n }) => ({ id, name: n }));
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

  // Fetch all exercises for this coach + global, ordered coach-first
  const rows = await fetchCatalogRowsForResolve(coachId);
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
 *
 * Pages internally past PostgREST's ~1000-row response cap — the global
 * catalog alone sits at that boundary, so a single-shot read silently
 * truncates once coach customs push the union past it. The `id` tiebreak
 * keeps offset paging stable across rows that share a name.
 */
export async function getExercisesForCoach(
  coachId: string,
  search?: string
): Promise<Exercise[]> {
  const PAGE = 1000;
  const rows: ExerciseRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin
      .from("exercises")
      .select("*")
      .or(`coach_id.eq.${coachId},coach_id.is.null`)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to fetch exercises: ${error.message}`);

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  return dedupeRowsById(rows).map(mapExerciseCatalogRow);
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

export type RecentExercise = {
  exerciseId: string;
  name: string;
  muscleGroup: string | null;
};

/**
 * Most-recently-used catalog exercises for a coach, derived from
 * coach_saved_exercises: builder saves are wipe-and-reinsert, so created_at
 * reads as "last time a session containing this exercise was saved" — the
 * right recency signal for the picker's "Recently used" strip. Rows with
 * exercise_id NULL (free-text that never resolved) are skipped: the strip
 * needs a catalog identity to re-pick. The LOOKBACK window is a recency
 * heuristic, not a completeness guarantee — 200 rows comfortably covers
 * `limit` distinct exercises for any real library.
 */
export async function getRecentExercisesForCoach(
  coachId: string,
  limit = 8
): Promise<RecentExercise[]> {
  const LOOKBACK = 200;
  const { data, error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .select(
      "exercise_id, created_at, exercises(name, muscle_group), coach_saved_sessions!inner(coach_id)"
    )
    .eq("coach_saved_sessions.coach_id", coachId)
    .not("exercise_id", "is", null)
    // Rows of one save share a created_at (single-transaction batch insert),
    // so tie-break on session position + id — otherwise the strip's subset
    // and order reshuffle arbitrarily between fetches.
    .order("created_at", { ascending: false })
    .order("order_index", { ascending: true })
    .order("id", { ascending: true })
    .limit(LOOKBACK);

  if (error)
    throw new Error(`Failed to fetch recent exercises: ${error.message}`);

  const recent: RecentExercise[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    // The exercises embed is a to-one FK; supabase-js may still type it as an
    // array depending on schema introspection, so normalize both shapes.
    const exercise = Array.isArray(row.exercises)
      ? row.exercises[0]
      : row.exercises;
    if (!row.exercise_id || !exercise || seen.has(row.exercise_id)) continue;
    seen.add(row.exercise_id);
    recent.push({
      exerciseId: row.exercise_id,
      name: exercise.name,
      muscleGroup: exercise.muscle_group,
    });
    if (recent.length >= limit) break;
  }

  return recent;
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
