/**
 * A figure as the Habits tab writes it, done of planned — "4/7" — or null,
 * shown as a dash, when nothing was planned: a week's met over its planned
 * (This week, each row's Week), or today's planned habits done today.
 * The counts are the kernel's; this only writes them.
 */
export function habitFigure(done: number, planned: number): string | null {
  return planned === 0 ? null : `${done}/${planned}`;
}
