/**
 * A habit moved one place up or down among the habits a move reorders — the
 * running and starting-later ones (`movableHabitIds`) — as a new order of the
 * client's WHOLE list: the order route takes every one of the client's
 * habits, stopped ones included, and refuses a part. The habits moved among
 * keep the slots they hold in the whole list; only their order among those
 * slots changes. Null when the habit cannot move that way.
 */
export function orderAfterMove(
  allIds: readonly string[],
  movableIds: readonly string[],
  habitId: string,
  direction: "up" | "down"
): string[] | null {
  const from = movableIds.indexOf(habitId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= movableIds.length) return null;

  const reordered = [...movableIds];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

  const movable = new Set(movableIds);
  const slots = allIds.flatMap((id, index) => (movable.has(id) ? [index] : []));
  const next = [...allIds];
  slots.forEach((slot, i) => {
    next[slot] = reordered[i];
  });
  return next;
}
