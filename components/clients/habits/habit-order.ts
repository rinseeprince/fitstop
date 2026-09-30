/**
 * A habit moved one place up or down among the habits on screen, as a new
 * order of the client's WHOLE list: the order route takes every one of the
 * client's habits, stopped ones included, and refuses a part, so a search
 * that shows some of them still sends them all. The habits on screen keep the
 * slots they hold in the whole list; only their order among those slots
 * changes. Null when the habit cannot move that way.
 */
export function orderAfterMove(
  allIds: readonly string[],
  shownIds: readonly string[],
  habitId: string,
  direction: "up" | "down"
): string[] | null {
  const from = shownIds.indexOf(habitId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= shownIds.length) return null;

  const reordered = [...shownIds];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

  const shown = new Set(shownIds);
  const slots = allIds.flatMap((id, index) => (shown.has(id) ? [index] : []));
  const next = [...allIds];
  slots.forEach((slot, i) => {
    next[slot] = reordered[i];
  });
  return next;
}
