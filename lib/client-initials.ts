/**
 * The initials shown in a client's avatar square.
 *
 * One implementation, because there were five and they disagreed: some split
 * on a single space (so a double space produced a blank initial), some kept
 * every word (so "Mary Jane Watson" became MJW in one place and MJ in another),
 * and one took a `Client | null` plus a fallback user. New surfaces import this
 * rather than adding a sixth.
 *
 * Splits on any run of whitespace and takes the first two words, so a name with
 * a middle name, a double space or a trailing space renders the same everywhere.
 */
export function clientInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
