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
