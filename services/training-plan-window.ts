/**
 * The "does this plan's window cover `date`?" half of training-plan resolution.
 *
 * Under additive placement plans are coexisting provenance rows, so "the plan
 * they are on" is a date question, not a status question. That predicate was
 * hand-rolled at every reader and had already drifted: the client-facing reader
 * carried `.is("effective_until", null)` and no date bound at all, which is how
 * a program starting next month could title a client's Program tab today.
 *
 * The STATUS half deliberately stays at each call site, because the two
 * audiences legitimately differ: coach reads exclude only 'archived', while the
 * client read requires 'active'. `training_plans.status` accepts all four
 * CHECK values through `PATCH /api/clients/[id]/training/[planId]`, so a coach
 * read's `.neq("status", "archived")` would show clients 'draft' and 'planned'
 * plans. Never fold status in here.
 *
 * The window-flipped twin ("starts after `date`") lives in
 * `getNextFutureTrainingPlan` and has no `effective_until` clause, so it is not
 * expressible through this helper.
 */

/** Structural shape of the two PostgREST filters this applies (self-returning). */
type WindowFilterable<T> = {
  lte(column: string, value: string): T;
  or(filters: string): T;
};

export function coversDate<T extends WindowFilterable<T>>(query: T, date: string): T {
  return query
    .lte("effective_from", date)
    .or(`effective_until.gte.${date},effective_until.is.null`);
}
