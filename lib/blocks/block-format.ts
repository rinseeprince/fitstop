import { format } from "date-fns";

// Local-midnight parse (the delete-event-dialog precedent): `new Date(iso)`
// alone parses UTC midnight and shifts a day in negative-offset zones.
function parseLocal(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

/** "7 Sep", with the year appended only when it isn't the current one. */
export function formatBlockDate(iso: string): string {
  const date = parseLocal(iso);
  return format(
    date,
    date.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy"
  );
}

/**
 * "24 Aug – 4 Oct" — a window as the block card's header spells a block's, so
 * a plan's range on the card and its timeline read in the block's own grammar.
 * A window of one day is one date: "7 Sep", never "7 Sep – 7 Sep".
 */
export function formatBlockRange(startsOn: string, endsOn: string): string {
  return startsOn === endsOn
    ? formatBlockDate(startsOn)
    : `${formatBlockDate(startsOn)} – ${formatBlockDate(endsOn)}`;
}

/**
 * "−629 kcal/day", "+120 kcal/day", "±0 kcal/day".
 *
 * Positive `deficitPerDay` is a DEFICIT and renders with a minus: the number
 * describes the gap below TDEE, and the sign the coach reads is the direction
 * the calories moved. Shared so the block card's nutrition column and its
 * timeline cannot disagree about that inversion.
 */
function formatDeficitPerDay(deficitPerDay: number): string {
  const { value, unit } = splitDeficitPerDay(deficitPerDay);
  return `${value} ${unit}`;
}

/**
 * The same figure in two halves — "+2,433" and "kcal/day" — for a surface that
 * sets the number in the target's own weight and the unit in the unit's, as
 * the block card's nutrition column does beside "5,000 kcal". One sign rule
 * (above) and one thousands separator for both halves of the line.
 */
export function splitDeficitPerDay(deficitPerDay: number): { value: string; unit: string } {
  const sign = deficitPerDay > 0 ? "−" : deficitPerDay < 0 ? "+" : "±";
  return {
    value: `${sign}${Math.round(Math.abs(deficitPerDay)).toLocaleString()}`,
    unit: "kcal/day",
  };
}

/** "3,471 kcal · −629 kcal/day" — one era, as a standalone data string. */
export function formatNutritionEra(era: {
  calories: number;
  deficitPerDay: number | null;
}): string {
  const kcal = `${Math.round(era.calories).toLocaleString()} kcal`;
  return era.deficitPerDay != null
    ? `${kcal} · ${formatDeficitPerDay(era.deficitPerDay)}`
    : kcal;
}

/** "4 weeks", "4 weeks 3 days", "5 days" — a day-granular block length. */
export function formatBlockLength(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  const dayPart = `${rest} ${rest === 1 ? "day" : "days"}`;
  if (weeks === 0) return dayPart;
  const weekPart = `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  return rest === 0 ? weekPart : `${weekPart} ${dayPart}`;
}
