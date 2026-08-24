// One-input rep schemes for the set-row editor.
//
// The stored model is unchanged: `reps_min` / `reps_max` on a SetSpec. This
// module only owns the string a coach types into the single Reps box and the
// string they read back out, so the editor can drop the two-box + dash layout
// without narrowing what the model can hold.
//
// Total by design. A half-open range (min with no max, or the reverse) is
// storable and therefore must round-trip, even though no coach can currently
// author one: a probe of every authored spec on 2026-08-24 (5,550 specs across
// coach_saved_exercises + training_exercises) found ZERO half-open ranges, and
// the current two-box editor reverts a blanked field rather than writing null.
// Formatting those as "8-" / "-12" keeps a legacy row editable instead of
// silently rewriting it the first time someone tabs through the field.
//
// Bounds mirror setSpecSchema (reps 0-100, integer) so the client-side
// safeParse belt never trips on a value this module produced.

export type RepsRange = {
  min: number | null;
  max: number | null;
};

const REPS_FLOOR = 0;
const REPS_CEILING = 100;

const clampReps = (n: number): number =>
  Math.round(Math.min(REPS_CEILING, Math.max(REPS_FLOOR, n)));

/**
 * The string shown in the Reps box for a stored range.
 *
 * A single number means min === max — the same collapse `setsRepsShort` already
 * applies to session-card summaries, so the editor and the card agree.
 */
export function formatRepsRange({ min, max }: RepsRange): string {
  if (min == null && max == null) return "";
  if (min != null && max != null) {
    return min === max ? String(min) : `${min}-${max}`;
  }
  return min != null ? `${min}-` : `-${max}`;
}

/**
 * Parse what the coach typed, or `null` when it is not a rep scheme.
 *
 * `null` is a REJECTION, not an empty range — the caller reverts the input to
 * its seeded string and writes nothing, so a typo can never blank a
 * prescription. An empty string is a real value (both bounds null) and parses
 * to a range, not a rejection.
 *
 * En/em dashes are accepted because coaches paste from their own notes; output
 * is always the ASCII hyphen. A reversed range ("12-8") is ordered rather than
 * rejected — the intent is unambiguous and refusing it would only make the
 * coach retype it.
 */
export function parseRepsRange(raw: string): RepsRange | null {
  const text = raw.trim().replace(/[‒–—―]/g, "-");
  if (text === "") return { min: null, max: null };

  const single = /^(\d{1,3})$/.exec(text);
  if (single) {
    const n = clampReps(Number(single[1]));
    return { min: n, max: n };
  }

  const both = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(text);
  if (both) {
    const a = clampReps(Number(both[1]));
    const b = clampReps(Number(both[2]));
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  }

  const minOnly = /^(\d{1,3})\s*-$/.exec(text);
  if (minOnly) return { min: clampReps(Number(minOnly[1])), max: null };

  const maxOnly = /^-\s*(\d{1,3})$/.exec(text);
  if (maxOnly) return { min: null, max: clampReps(Number(maxOnly[1])) };

  return null;
}
