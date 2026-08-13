/**
 * `clients` has ONE `name` column — there is no stored first name — so any
 * surface addressing a client by name splits it here rather than inline.
 *
 * Every other `.split(" ")` in the repo computes avatar initials, which is a
 * different question; this is the only shared answer to "what do I call them?".
 */

/**
 * The client's first name, or `null` when there isn't one to use.
 *
 * Returning null rather than `""` is deliberate: a blank or whitespace-only
 * `clients.name` is real (the coach invited them by email and never filled it
 * in), and an empty string silently renders "Visible to " or "Hey !". Callers
 * must supply their own fallback wording, which forces the empty case to be
 * answered at each call site instead of leaking a hole into the UI.
 */
export function getFirstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
