import type { UnitPreference } from "@/types/check-in";

/**
 * Unit conversion and presentation-boundary formatting.
 *
 * Storage is canonical: every weight is kilograms, every length is centimetres
 * (CONVENTIONS.md §20 Units). Nothing between the database and the
 * render layer knows about lbs or inches — these helpers are that boundary, so
 * a formatter takes the stored value plus the VIEWER's preference and there is
 * no per-record unit to pass.
 *
 * `KG_PER_LB`, `CM_PER_IN`, `METERS_PER_MILE` and `METERS_PER_YARD` are the
 * only unit-conversion factors in this file, deliberately: the codebase
 * previously held four conflicting lbs↔kg constants (2.205, 2.20462, 0.453592,
 * and /2.205 inside SQL).
 * `INCHES_PER_FOOT` and `IMPERIAL_LOAD_INCREMENT_LB` are not conversion
 * factors — one is composite-unit arithmetic, the other a plate increment.
 *
 * Formatters return numbers, never pre-formatted strings: callers own display
 * rounding. The one exception is `formatHeight`, which must round to whole
 * inches itself in order to carry 12 inches into the next foot.
 *
 * This is the ONLY module that converts units. `utils/nutrition-helpers.ts`
 * used to export a colliding `formatWeight` plus its own lbs/kg helpers; all of
 * them are deleted. If you find yourself writing a conversion factor anywhere
 * else, it belongs here.
 */

/**
 * The viewer's unit system. Structurally the same union as `UnitPreference`,
 * aliased rather than redeclared so the two can never drift; `UnitPreference`
 * stays the declaration site because `utils/ → types/` is this repo's existing
 * dependency direction.
 */
export type UnitSystem = UnitPreference;

/**
 * What an unresolved viewer is shown. Metric deliberately: the ORIGINAL column
 * defaults were imperial, which is backwards for this platform (206 of 208 Dev
 * clients were kg). Migrations 140 and 141 flipped both preference columns to
 * 'metric' and dropped the unit-tag columns entirely.
 *
 * Declared here rather than beside the server resolver so the client bundle can
 * import it without pulling in `supabaseAdmin`.
 */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = "metric";

/** Exact, by definition of the international pound. */
export const KG_PER_LB = 0.45359237;
/** Exact, by definition of the international inch. */
export const CM_PER_IN = 2.54;

/**
 * Smallest increment worth showing an imperial viewer. Only used by
 * `formatLoad` — see its note on why loads snap and body weights do not.
 *
 * 2.5, not 5. Five is the barbell increment (a pair of 2.5 lb plates) and was
 * the original choice, but most prescriptions in practice are dumbbells and
 * machine stacks, which step in 2.5 lb through the range where the error hurts.
 * At 5 lb a 10 kg lateral raise renders as 20 lb rather than 22.5 — 9% light —
 * and worse, a coach's 2.5 kg weekly bump renders as a 10 lb jump against a real
 * 5.5 lb, so the client reads a progression nearly twice the size of the actual
 * one. Above ~40 kg the two increments are indistinguishable.
 *
 * Product owner signed off 2026-08-06, superseding the 5 lb choice in Phase 1.
 */
const IMPERIAL_LOAD_INCREMENT_LB = 2.5;

/** Composite-unit arithmetic for imperial height, not a conversion factor. */
const INCHES_PER_FOOT = 12;

type WeightDisplay = { value: number; unit: "kg" | "lbs" };
type LengthDisplay = { value: number; unit: "cm" | "in" };
type HeightDisplay =
  | { system: "metric"; value: number; unit: "cm" }
  | { system: "imperial"; feet: number; inches: number };

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

export function inToCm(inches: number): number {
  return inches * CM_PER_IN;
}

export function cmToIn(cm: number): number {
  return cm / CM_PER_IN;
}

/**
 * Body weight, goal weight, weight change — converts freely, never snaps.
 * A metric viewer gets the stored kilograms back unchanged.
 */
export function formatWeight(valueKg: number, viewer: UnitSystem): WeightDisplay {
  return viewer === "imperial"
    ? { value: kgToLbs(valueKg), unit: "lbs" }
    : { value: valueKg, unit: "kg" };
}

/**
 * Girth measurements (waist, hips, chest, arms, thighs). Decimal inches are
 * correct here — unlike height, which is composite. See `formatHeight`.
 */
export function formatLength(valueCm: number, viewer: UnitSystem): LengthDisplay {
  return viewer === "imperial"
    ? { value: cmToIn(valueCm), unit: "in" }
    : { value: valueCm, unit: "cm" };
}

/**
 * Prescribed or logged barbell load — a distinct helper from `formatWeight`,
 * not an option on it.
 *
 * Body weight converts cleanly in both directions; a barbell does not. Convert
 * a prescribed 100 kg faithfully and an imperial gym sees 220.5 lbs, which
 * cannot be loaded — they will put 220 on the bar. A precise-looking
 * unloadable number is worse than no conversion at all, so an imperial viewer
 * gets the conversion snapped to the nearest loadable increment.
 *
 * DELIBERATE DEVIATION from the original spec, which also called for a 2.5 kg
 * snap for metric viewers. Metric is the IDENTITY path:
 * no conversion happens, so snapping there does not round a conversion artefact,
 * it rewrites stored data at the display layer — a client's logged 47 kg would
 * render as 47.5, an Epley e1RM of 102.3 as 102.5, and a session volume total
 * of 12,347 as 12,347.5. Metric is therefore pass-through. Signed off by the
 * product owner 2026-08-06.
 *
 * The loadable increment is really a property of the client's gym rather than
 * of the viewer's preference; modelling gym-unit separately is out of scope and
 * snapping to the viewer's system is right in the overwhelming majority of cases.
 */
export function formatLoad(valueKg: number, viewer: UnitSystem): WeightDisplay {
  if (viewer !== "imperial") return { value: valueKg, unit: "kg" };

  // 2.5 is exactly representable in binary floating point and the quotient is
  // rounded to an integer first, so the product carries no float dust.
  const lbs = kgToLbs(valueKg);
  const snapped =
    Math.round(lbs / IMPERIAL_LOAD_INCREMENT_LB) * IMPERIAL_LOAD_INCREMENT_LB;
  return { value: snapped, unit: "lbs" };
}

/**
 * Height, which is composite in imperial — 5'11", never "71 in". Hence the
 * discriminated union rather than `{ value, unit }`.
 *
 * This is the one formatter that rounds, because it must: the carry from 12
 * inches into the next foot cannot be done at the call site after the fact
 * (rounding 11.988 in at the call site yields 5'12").
 */
export function formatHeight(valueCm: number, viewer: UnitSystem): HeightDisplay {
  if (viewer !== "imperial") {
    return { system: "metric", value: valueCm, unit: "cm" };
  }

  const totalInches = cmToIn(valueCm);
  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = Math.round(totalInches - feet * INCHES_PER_FOOT);

  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }

  return { system: "imperial", feet, inches };
}

/**
 * Request-payload weight + the unit tag that payload carried → canonical kg.
 *
 * Distinct from `parseWeightToKg`, which takes the VIEWER's preference: this
 * takes a `"lbs" | "kg"` tag travelling on the wire beside the value. Exactly
 * one caller remains — `actualsFromWire` in `utils/set-log-measures.ts`, for
 * `logTrainingEventSchema`'s REQUIRED `weightUnit` field, which exists so a
 * non-web client (React Native) can log in its own unit. The web log form
 * converts first and sends `"kg"` (`log-form-types.ts`).
 *
 * Its length counterpart was deleted with the client-profile forms in Phase 4:
 * no wire schema carries a length tag any more.
 *
 * The tag being REQUIRED where this is used is what makes it safe. A tag that
 * can be absent needs a fallback, and a fallback silently decides the unit for
 * a payload that never stated one — which is how pounds got stored as
 * kilograms in the first place.
 *
 * `undefined` in, `undefined` out, so a caller can pass an absent optional field
 * straight through without a null dance.
 */
export function toCanonicalWeightKg(
  value: number | undefined,
  tag: "lbs" | "kg" | undefined
): number | undefined {
  return value != null && tag === "lbs" ? lbsToKg(value) : value;
}

/** Form input in the viewer's unit → canonical kilograms for storage. */
export function parseWeightToKg(input: number, viewer: UnitSystem): number {
  return viewer === "imperial" ? lbsToKg(input) : input;
}

/** Form input in the viewer's unit → canonical centimetres for storage. */
export function parseLengthToCm(input: number, viewer: UnitSystem): number {
  return viewer === "imperial" ? inToCm(input) : input;
}

/**
 * Height input → canonical centimetres. Takes the shape the form collected
 * rather than a viewer preference, because an imperial height input is two
 * fields (feet + inches) and a metric one is a single centimetre field.
 */
export function parseHeightToCm(
  input: { cm: number } | { feet: number; inches: number }
): number {
  if ("cm" in input) return input.cm;
  return inToCm(input.feet * INCHES_PER_FOOT + input.inches);
}

/**
 * Normalize a stored `unit_preference` column into the union.
 *
 * `null` is legitimate — `clients.unit_preference` is nullable (migration 011)
 * — and defaults quietly to metric. Any other unexpected value means the CHECK
 * constraint was bypassed or the column changed meaning, so it warns rather
 * than defaulting in silence.
 */
export function toUnitSystem(value: string | null | undefined): UnitSystem {
  if (value === "imperial") return "imperial";
  if (value === "metric") return "metric";
  if (value != null) {
    console.warn(
      "[units] Unexpected unit_preference value, defaulting to metric:",
      value
    );
  }
  return "metric";
}

// ---------------------------------------------------------------------------
// Distance and time (CONVENTIONS section 20, migrations 183 and 184)
//
// Storage is canonical: metres, seconds, seconds per kilometre, seconds per
// 500 m. Nobody types or reads the stored unit. What a box takes and what it
// shows back are decided here, once, for every box that converts or formats —
// the client's log form today, the builder's endurance inputs in commit 12 —
// so the grammar a client learns is the grammar every screen speaks.
//
// `METERS_PER_MILE` and `METERS_PER_YARD` are the only distance factors in
// the codebase, for the same reason `KG_PER_LB` is the only mass one.
// ---------------------------------------------------------------------------

/** Exact, by definition of the international mile. */
export const METERS_PER_MILE = 1609.344;
/** Exact, by definition of the international yard. */
export const METERS_PER_YARD = 0.9144;
const YARDS_PER_MILE = 1760;

/**
 * The grammars a box can speak. A measure names one in
 * `utils/set-log-measures.ts`; `parseEntry` / `formatEntry` dispatch on it.
 */
export type EntryKind =
  | "load"
  | "number"
  | "distance"
  | "duration"
  | "pace"
  | "split"
  | "zone"
  | "tempo";

const roundTo = (n: number, scale: number): number => {
  const factor = 10 ** scale;
  return Math.round(n * factor) / factor;
};

/** "5", "5.2", "4.99": a number with up to `scale` decimals and no trailing zeros. */
const trimmed = (n: number, scale: number): string => String(roundTo(n, scale));

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Seconds as a clock: "m:ss", with a tenth when there is one ("6:45.3").
 * Minutes run past 59 ("75:00"); an hour-carrying form is `formatDuration`.
 */
function clock(seconds: number): string {
  const total = roundTo(seconds, 1);
  const minutes = Math.floor(total / 60);
  const rest = roundTo(total - minutes * 60, 1);
  const whole = Math.floor(rest);
  const tenth = Math.round((rest - whole) * 10);
  return `${minutes}:${pad2(whole)}${tenth > 0 ? `.${tenth}` : ""}`;
}

// --- Distance ---------------------------------------------------------------

const DISTANCE_RE =
  /^(\d+(?:\.\d+)?)\s*(m|metre|metres|meter|meters|km|kilometre|kilometres|kilometer|kilometers|yd|yard|yards|mi|mile|miles)?$/i;

const DISTANCE_UNIT: Record<string, number> = {
  m: 1,
  metre: 1,
  metres: 1,
  meter: 1,
  meters: 1,
  km: 1000,
  kilometre: 1000,
  kilometres: 1000,
  kilometer: 1000,
  kilometers: 1000,
  yd: METERS_PER_YARD,
  yard: METERS_PER_YARD,
  yards: METERS_PER_YARD,
  mi: METERS_PER_MILE,
  mile: METERS_PER_MILE,
  miles: METERS_PER_MILE,
};

/**
 * What a client typed as a distance → canonical metres to a hundredth, or
 * null when it is not a distance. A bare number is kilometres, or miles for an
 * imperial viewer; a unit typed in the box wins over the viewer's units, so
 * "400 m" and "800 yd" read the same for everyone.
 */
export function parseDistance(text: string, viewer: UnitSystem): number | null {
  const match = DISTANCE_RE.exec(text.trim());
  if (!match) return null;
  const unit = (match[2] ?? (viewer === "imperial" ? "mi" : "km")).toLowerCase();
  return roundTo(Number(match[1]) * DISTANCE_UNIT[unit], 2);
}

/**
 * Canonical metres as the viewer reads them: metres under a kilometre and
 * kilometres from one up ("400 m", "5.2 km"); yards under a mile and miles
 * from one up for an imperial viewer ("800 yd", "3.1 mi").
 */
export function formatDistance(metres: number, viewer: UnitSystem): string {
  if (viewer === "imperial") {
    const yards = metres / METERS_PER_YARD;
    if (yards < YARDS_PER_MILE) return `${Math.round(yards)} yd`;
    return `${trimmed(metres / METERS_PER_MILE, 2)} mi`;
  }
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${trimmed(metres / 1000, 2)} km`;
}

// --- Duration ---------------------------------------------------------------

const HMS_RE = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d)?)$/;
const MS_RE = /^(\d+):(\d{1,2}(?:\.\d)?)$/;
const HOURS_RE =
  /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/i;
const MINUTES_RE = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)$/i;
const SECONDS_RE = /^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)$/i;
const BARE_NUMBER_RE = /^(\d+(?:\.\d+)?)$/;

/**
 * What a client typed as a duration → canonical seconds to a tenth, or null
 * when it is not one. Hours and minutes: "2:00:00", "45:00", "0:45", "2h",
 * "1h30", "90 min", "45s", "6:45.3". A bare number means minutes, so "120" is
 * a two-hour run; seconds need a colon or an s.
 */
export function parseDuration(text: string): number | null {
  const raw = text.trim();
  let seconds: number | null = null;

  const hms = HMS_RE.exec(raw);
  const ms = hms ? null : MS_RE.exec(raw);
  if (hms) {
    const [, h, m, s] = hms;
    if (Number(m) >= 60 || Number(s) >= 60) return null;
    seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  } else if (ms) {
    const [, m, s] = ms;
    if (Number(s) >= 60) return null;
    seconds = Number(m) * 60 + Number(s);
  } else {
    const hours = HOURS_RE.exec(raw);
    const minutes = hours ? null : MINUTES_RE.exec(raw);
    const secs = hours || minutes ? null : SECONDS_RE.exec(raw);
    const bare = hours || minutes || secs ? null : BARE_NUMBER_RE.exec(raw);
    if (hours) seconds = Number(hours[1]) * 3600 + Number(hours[2] ?? 0) * 60;
    else if (minutes) seconds = Number(minutes[1]) * 60;
    else if (secs) seconds = Number(secs[1]);
    else if (bare) seconds = Number(bare[1]) * 60;
  }

  return seconds == null ? null : roundTo(seconds, 1);
}

/**
 * Canonical seconds as a client reads them: "2:00:00" from an hour up,
 * "45:00" below, a tenth kept when there is one ("6:45.3").
 */
export function formatDuration(seconds: number): string {
  const total = roundTo(seconds, 1);
  if (total < 3600) return clock(total);
  const hours = Math.floor(total / 3600);
  const rest = total - hours * 3600;
  const minutes = Math.floor(rest / 60);
  return `${hours}:${pad2(minutes)}:${clock(rest - minutes * 60).slice(2)}`;
}

// --- Pace --------------------------------------------------------------------

const PACE_RE = /^(\d+):(\d{1,2})\s*(?:\/\s*(km|mi|mile))?$/i;

/**
 * What a client typed as a pace → canonical whole seconds per kilometre, or
 * null. Minutes and seconds, per kilometre or per mile by the viewer's units
 * unless the box says which ("4:45", "4:45 /km", "7:39 /mi"). Stored as typed,
 * never worked out from distance and duration.
 */
export function parsePace(text: string, viewer: UnitSystem): number | null {
  const match = PACE_RE.exec(text.trim());
  if (!match) return null;
  const [, minutes, seconds, unitRaw] = match;
  if (Number(seconds) >= 60) return null;
  const perUnit = Number(minutes) * 60 + Number(seconds);
  const perMile = unitRaw ? unitRaw.toLowerCase() !== "km" : viewer === "imperial";
  return Math.round(perMile ? (perUnit * 1000) / METERS_PER_MILE : perUnit);
}

/** Canonical seconds per km as the viewer reads them: "4:45 /km" or "7:39 /mi". */
export function formatPace(secondsPerKm: number, viewer: UnitSystem): string {
  if (viewer === "imperial") {
    return `${clock(Math.round((secondsPerKm * METERS_PER_MILE) / 1000))} /mi`;
  }
  return `${clock(Math.round(secondsPerKm))} /km`;
}

// --- Split -------------------------------------------------------------------

const SPLIT_RE = /^(\d+):(\d{1,2}(?:\.\d)?)\s*(?:\/\s*500\s*m)?$/i;

/** What a client typed as an erg split → canonical seconds per 500 m to a tenth, or null. */
export function parseSplit(text: string): number | null {
  const match = SPLIT_RE.exec(text.trim());
  if (!match) return null;
  const [, minutes, seconds] = match;
  if (Number(seconds) >= 60) return null;
  return roundTo(Number(minutes) * 60 + Number(seconds), 1);
}

/** Seconds per 500 m as everyone reads them: "1:52.3 /500m". */
export function formatSplit(secondsPer500m: number): string {
  return `${clock(secondsPer500m)} /500m`;
}

// --- Heart-rate zone -------------------------------------------------------------

const ZONE_RE = /^z?\s*(\d)$/i;

/** "2" or "Z2" → 2; anything else is null (the bound is the validator's). */
export function parseZone(text: string): number | null {
  const match = ZONE_RE.exec(text.trim());
  return match ? Number(match[1]) : null;
}

export function formatZone(zone: number): string {
  return `Z${zone}`;
}

// --- Load and plain numbers ----------------------------------------------------

/**
 * The string an editable absolute load is seeded with, in the viewer's unit —
 * one decimal, UNSNAPPED. Not `formatLoad`: a snap seeded into an editable
 * box would round-trip into storage the first time someone tabbed through it.
 * `program-builder/commit-input.ts`'s `displayLoad` is this function.
 */
export function formatLoadEntry(valueKg: number, viewer: UnitSystem): string {
  return String(roundTo(viewer === "imperial" ? kgToLbs(valueKg) : valueKg, 1));
}

/** A load typed in the viewer's unit → canonical kilograms to a hundredth, or null. */
function parseLoadEntry(text: string, viewer: UnitSystem): number | null {
  const match = BARE_NUMBER_RE.exec(text.trim());
  if (!match) return null;
  return roundTo(parseWeightToKg(Number(match[1]), viewer), 2);
}

function parseNumberEntry(text: string): number | null {
  const match = BARE_NUMBER_RE.exec(text.trim());
  return match ? Number(match[1]) : null;
}

// --- The dispatch a box goes through ----------------------------------------------

/**
 * What a box's text means, canonically, or null when it cannot be read. An
 * empty box is the caller's to notice first: it means "not recorded", not a
 * reading failure. A tempo is returned as typed — its grammar is the
 * validator's (`TEMPO_PATTERN`).
 */
export function parseEntry(
  kind: EntryKind,
  text: string,
  viewer: UnitSystem,
): number | string | null {
  switch (kind) {
    case "load":
      return parseLoadEntry(text, viewer);
    case "number":
      return parseNumberEntry(text);
    case "distance":
      return parseDistance(text, viewer);
    case "duration":
      return parseDuration(text);
    case "pace":
      return parsePace(text, viewer);
    case "split":
      return parseSplit(text);
    case "zone":
      return parseZone(text);
    case "tempo": {
      const trimmedText = text.trim();
      return trimmedText === "" ? null : trimmedText;
    }
  }
}

/**
 * What a box shows for a canonical value — the form the client sees when they
 * leave the box, and the form a logged value reopens as. Every string this
 * returns is readable by `parseEntry`, at the display's precision: an imperial
 * distance or load rounds for reading, which is why an untouched box resubmits
 * the value it was seeded with rather than re-parsing what it shows.
 */
export function formatEntry(
  kind: EntryKind,
  value: number | string,
  viewer: UnitSystem,
): string {
  if (typeof value === "string") return value;
  switch (kind) {
    case "load":
      return formatLoadEntry(value, viewer);
    case "number":
      return String(value);
    case "distance":
      return formatDistance(value, viewer);
    case "duration":
      return formatDuration(value);
    case "pace":
      return formatPace(value, viewer);
    case "split":
      return formatSplit(value);
    case "zone":
      return formatZone(value);
    case "tempo":
      return String(value);
  }
}
