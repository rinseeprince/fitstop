# Technical Debt Tracker

## `blocks/facts` payload is no longer bounded by the block count — it grows with note volume

Logged: 2026-08-13 (**measured**, not inferred — `docs/perf-baseline.md`, Session 6).

Session 3.2 established that `GET /api/clients/[id]/blocks/facts` returns "≤20 fact rows regardless of span", which made its wire payload bounded by the *result* rather than by history. Session 6 attached the block's plan-save notes to each fact row, so that property is now weaker: the row count is still ≤20, but each row carries every note whose `effective_on` falls in its window.

Measured against the year-scale fixture (`PERF_CLIENT_ID`, 4 blocks, 365 days):

| notes | queries | warm p50 | payload |
|---:|---:|---:|---:|
| 52 (realistic — weekly saves) | 5 | ~80–95 ms | ~10 KB |
| 1,200 (pathological) | 6 | 149 ms | ~208 KB |

**Not urgent, and here is why:** 52 notes is a coach saving a plan every week for a year, and 1,200 is over three saves a day for a year — well past anything a human does. The read itself stays complete and correct at both (the extra query at 1,200 is `fetchAllPages` taking its second page, exactly as designed). **The client path is unaffected at any volume** — `getClientJourney` reads only the current block's window and measured flat at 84 ms / 5 queries with 1,200 notes on the client.

If it ever does bite, the fix is a per-block cap with a "show all" affordance, not paging the facts endpoint — a coach reading a block timeline wants the recent notes, and the endpoint already returns per-block groups to hang a cap on.

---

## The plan-save note exists in two copies that cannot be reconciled

Logged: 2026-08-13 (created deliberately by Session 6 of the goals/blocks plan — owner decision to keep the calendar marker AND add the durable client-visible note, rather than repoint one to the other).

The coach's "why am I adjusting this plan?" sentence is written to **two stores with incompatible mutability and no link between them** (`recordPlanSaveNote`, `services/nutrition-plan-notes-service.ts`):

| | `nutrition_events.coach_note` | `nutrition_plan_notes` |
|---|---|---|
| cardinality | one row per date, overwritten by the next stamp | one row per save, append-only |
| mutability | mutable | no `UPDATE` and no `DELETE` path, by design |
| identity | none — a column on a regenerable event | its own `id` |

There is **no FK and no shared id**, so the two copies cannot be paired after the fact. A date+client join does not rescue it either: a same-effective-date re-save leaves *one* stamp beside *two* note rows, so the join is ambiguous exactly where it matters.

**Latent, not broken.** Nothing edits or deletes a note today, so the copies cannot drift yet. It becomes real the moment someone builds note editing or deletion: they will meet a copy that can be changed and a copy that structurally cannot, with no way to tell which pairs with which. **Whoever builds that feature has to pick a canonical copy first, and the answer is not obvious** — the append-only table is the durable record and the one the client reads, but the event column is the one the coach sees on the calendar and the one a per-day edit UI would naturally target.

Recorded here rather than only in the workstream's STATUS block because that plan doc is deleted when the workstream lands (the Session 5 precedent for the `create_training_plan_atomic` twin below).

---

## Deficit as a first-class nutrition input — PARKED, with a named un-park trigger

Logged: 2026-08-13 (parked by owner decision during the goals/blocks workstream; migrated out of that plan doc before its deletion, because it is a design decision with a live trigger and not a record of shipped work).

`calculateBaselineCalories` (`services/nutrition-service.ts`) is **deadline-driven**: `requiredDailyChange = totalCalorieChange / daysToGoal` is the *average* deficit across the remaining span, and without a deadline it returns maintenance. A coach running a gentle four-week intro then a harder cut gets the same averaged number both times and overrides both times. The parked design made deadline and deficit **both first-class inputs, neither primary** — enter a deadline, see the implied deficit; enter a deficit, see the projected date — with the deficit **stored** so intent survives a recalculation when TDEE moves.

**Why it was parked, so it is not re-derived:** the capability already exists in a rougher form (a coach who wants −500 types 1,900 into custom calories against a TDEE of 2,400), and no coach has asked for it. Most of the surrounding UI work arrived anyway from other sessions — the builder shows TDEE, the warnings component renders, and the bare-TDEE silence when no goal is set was fixed.

**The un-park trigger, which got STRONGER not weaker.** Session 4B made TDEE recompute on every weight change, so a frozen custom-calorie number now drifts away from the coach's intended deficit more often, silently. That is soft only because plans never auto-regenerate, so the coach re-enters the number at their next regenerate. **Un-park if a coach reports that a plan's deficit "moved on its own", or asks to express a deficit as a percentage.**

Two design constraints that survive with it: the stored deficit is **intent, not a result** (it records what the coach chose; the suggestion, caps and floor are recomputed from it and never overwrite it), and **caps and the floor gate the SUGGESTION, never the coach's typed number** — a coach may type lower, and the app must *say* it capped rather than silently doing it. The full design is in the git history of `docs/CLIENT-GOALS-PHASES-EXECUTION-PLAN.md`; only the arity discipline needs re-reading against whatever `create_nutrition_plan_atomic`'s signature is by then.

---

## `updateGoals` is not atomic — two silent failure modes the unique index cannot catch

Logged: 2026-08-13 (migrated out of the goals/blocks plan doc before its deletion; re-verified against `main` on migration).

`updateGoals` (`services/client-goals-service.ts`) is three autocommitted PostgREST round trips with no transaction, no RPC, no advisory lock and no version check: a SELECT of the live goal (`:41`), a **set-based** UPDATE stamping `superseded_at` (`:76-78`) **with no `.select()`** — so a 0-row supersede is indistinguishable from a 1-row supersede — and an INSERT of the merged row (`:129`).

Two live failure modes:

- **Silent lost update.** If T2's supersede lands after T1's insert, it supersedes *T1's brand-new row*, then inserts values merged from its own stale read. Every field T1 changed that T2's payload omits is reverted. **Both callers get HTTP 200.** No error anywhere.
- **Zero active rows.** Supersede succeeds, insert fails → the client has no active goal and every surface renders "No goal set yet".

**The real fix already existed and was reverted.** Commit `dc9898c` shipped `update_client_goals_atomic`, a single RPC doing supersede + insert + mirror in one transaction; it was reverted and its migration slot reused by `139_nutrition_event_coach_note.sql`. Re-landing it needs a migration. Session 0's ordering belt is insurance against a *different* failure (a dropped index), not against these two.

---

## The two goal targets contradict each other on two live coach surfaces

Logged: 2026-08-13 (migrated out of the goals/blocks plan doc; not caused by that workstream and not fixed by it).

`goal_weight` and `goal_body_fat_percentage` are solved independently and reconciled by nobody:

- **Coach Overview status card** renders teal "Goal reached" on the goal-weight cell beside amber "4.0% to go" on the goal-body-fat cell — two chips from the same helper (`lib/goals/goal-state.ts` via `client-status-card.tsx`), computed side by side, never compared.
- **Check-in review page** prints "Body Fat: 4.0% to go" (`goal-progress-view.tsx`) directly above teal "On track to meet the goal by the deadline", because `progressNote` derives from `goalProgress.weight` alone.

Compounding it: **`isOnTrack` defaults to `true`** when `avgChange` is falsy (`utils/comparison-utils.ts:70`, guarded by `if (avgChange && avgChange !== 0)`), so a client with fewer than two body-fat check-ins reads "On track" no matter how far off they are.

Fixing this means choosing which target is the headline, or making the summary sentence read both. **That is a check-in-review decision, not a goals-plumbing one** — there is no lean-mass model in the repo, so the two targets cannot be reconciled arithmetically.

---

## Removing the `clients.*` goal mirror — costed, and its one real landmine

Logged: 2026-08-13 (migrated out of the goals/blocks plan doc, which costed it so the next attempt does not re-derive it).

`updateGoals` is already the sole writer of the mirror columns. **Full removal is a separate workstream:** ~21 production files, 12 test files, 3 scripts, 4 docs, 1 migration + `gen types` ≈ **42 files**. Three surfaces need a brand-new goal fetch — the coach Overview (`GET /api/clients/[id]`), the client portal Goals card, and `/api/client/me` (the RN contract). A "Tier B" that deletes the fallback reads and leaves the columns as dead data is **not separately shippable**: the moment writes stop, the mirror goes stale, so those three surfaces must convert in the same shipment. The `DROP` itself is trivially safe (`pg_depend = 0` on all three columns — measured on **DEV**; re-probe prod first).

**The riskiest single change is not the migration.** It is `CLIENT_SELF_COLUMNS` (`services/client-portal-service.ts:50-60`): a `+`-concatenated string, so TypeScript widens it to `string` and `tsc` cannot see a stale column name. It still lists `goal_weight` and `goal_body_fat_percentage`. Drop a column without editing that string and PostgREST 400s the whole query, `if (error || !data) return null` (`:75`) swallows it, and `/api/client/me` silently returns nothing.

---

## `client_goals.primary_goal` is dead weight, and a bare `DROP` breaks every goal write

Logged: 2026-08-13 (migrated out of the goals/blocks plan doc; line numbers re-derived on migration — the doc's were stale by ~29 lines).

Zero branches, zero production writers of a meaningful value, free `TEXT` with no CHECK. It is mapped (`services/client-goals-service.ts:15`), typed (`types/client-goals.ts:10`) and validated (`lib/validations/client-goals.ts:33`), but nothing branches on it.

**The landmine:** it is an **unconditional key** in the merged INSERT object (`client-goals-service.ts:122-124`, spread into the insert at `:129`), so a bare `DROP COLUMN` without the code change PGRST204s **every** goal write. Removal is ~3 lines plus a migration plus `gen types`.

Do not confuse it with `client_intake.primary_goal`, which is a live discriminator with three real branches.

---

## Nutrition write-path gaps: the `is_modified` race and the unshared 8-week horizon

Logged: 2026-08-13 (migrated out of the goals/blocks plan doc; **both counts re-derived** — the doc's "eight occurrences across five files" was stale).

- **The `is_modified` protection is a read-then-filter across a two-round-trip gap.** `regenerateFutureNutritionEvents` reads the protected days (`services/nutrition-event-service.ts:200`) and writes the upsert (`:226`) in separate round trips. A coach edit landing in that gap is clobbered. Only a transaction or an RPC closes it.
- **The 8-week nutrition horizon is duplicated with no shared constant.** **Two** occurrences today, not the eight the plan doc claimed: `services/nutrition-event-service.ts:376` and `services/training-event-service.ts:143`. Both use **server-local `Date` arithmetic** despite `addDaysToDateString` being UTC-safe, which is the part that actually bites. A smaller finding than recorded, but a real one.
- **Two columns on `nutrition_plans` are inert.** `name` is never written at all (no `p_name` in the migration-144 RPC, and no service writes it). `regeneration_reason` **is** written (`nutrition-plan-service.ts:156` via `p_regeneration_reason`) but never read — so it is write-only rather than dead, a different thing.

---

## `check:labels` cannot see the client surface

Logged: 2026-08-13 (migrated out of the goals/blocks plan doc).

`scripts/check-labels.ts` sets `SCAN_ROOTS = ["app", "components"]` (`:38`) and whitelists all of `components/client-portal/` and `app/client/`. **Nothing built on the client surface proves typography compliance**, so a green `check:labels` says nothing about the portal or the RN-contract screens. Worth knowing before citing that gate as coverage for a client-facing change.

---

## `create_training_plan_atomic`'s payload is still cast `as never` — nothing checks its 22 keys

Logged: 2026-08-13 (found while executing Session 5 Task 5.1 of the goals/blocks plan, which removed the identical casts from the nutrition twin; deliberately left out of scope — that session was one task, one commit).

`services/training-service.ts:354` casts the RPC **name** `as never` and `:377` casts the arg object `as never` then the response `as unknown as { data … }`. TypeScript therefore verifies nothing about the payload. A key that does not match the live signature makes PostgREST unable to resolve the overload (PGRST202); `createTrainingPlanAtomic` sees `rpcError`, and **every program placement fails** while `tsc`, `eslint` and `vitest` all stay green. It is strictly less protected than nutrition was before Session 5: `services/training-service.test.ts:48-55` and `:68-74` assert only three keys through `expect.objectContaining`, so there is **no exhaustive key-list belt either** — nothing at all pins the 22 keys.

**The fix, already proven on the nutrition twin.** Copy the shape from `services/nutrition-plan-service.ts` (`git log -S CreateNutritionPlanRpcPayload` finds the commit and its full reasoning). Do not skip straight to annotating with the generated `Args` — **it does not compile**, and that is the trap worth inheriting rather than re-deriving:

- `supabase gen types` derives an argument's type from its SQL type alone and **never emits `| null`**, so the generated `Args` types `p_client_tdee: number` where the function accepts NULL. On the training payload **15 of the 22 keys** pass `?? null` (`:358`, `:360`, `:363-374`, `:376`) and would each error `TS2322`.
- The working shape is a union of the null-carrying keys + `Required<Omit<Args, …>> & { [K in Keys]: Args[K] | null }`, applied with `satisfies` at the call site and one narrow `as Args` after it. `satisfies` runs first and completely, so the assertion can only launder nullability, never a key mismatch. `Required<>` matters: `p_effective_from`, `p_saved_plan_id`, `p_today` and `p_window_end` are `DEFAULT`ed in SQL and therefore **optional** in the generated `Args`, so without it a dropped `p_today` still compiles.
- The nullable-key union is hand-maintained and nothing checks it — say so in a comment beside it, as the nutrition copy does.
- Mutation-prove it (add a bogus key, drop a key, confirm `tsc` fails on each in isolation — an excess-property error masks a missing-property error, so test them separately). While you are there, consider adding the exhaustive key-list test the nutrition side has (`services/nutrition-plan-service.test.ts:161`), which catches the case the compile check cannot: an arity change riding in unnoticed on a regenerated `types/database.ts`.

---

## `getBodyMetricsHistory` silently truncates at ~1000 rows on its unbounded path

Logged: 2026-08-12 (observed while planning Session 4 of the goals/blocks execution plan; not fixed there — the session's weight reads went through the merged series instead, so no caller changed).

`getBodyMetricsHistory` (`services/body-metrics-service.ts`) issues a single unpaged query, so an unbounded call silently returns at most PostgREST's ~1000-row cap. **Every remaining in-repo caller passes `limit`** (mostly `limit: 1` via `getLatestBodyMetrics`). The one unbounded caller — `GET /api/clients/[id]/body-metrics`, whose `limit` could be `undefined` — was never wired to any UI and was deleted in the 2026-08-26 dead-code sweep (commit 3), so the truncation is no longer reachable. **Closed by deletion; the function's shape is unchanged** — a future caller that omits `limit` must page or bound the read (`lib/paged-fetch.ts`).

---

## Typography sweep (mono=numbers-only) — deferred tails

Logged: 2026-07-23 (platform-wide sweep; rule + enforcement in `docs/newdesignsystem.md` → Typography and `npm run check:labels`).

- **Out-of-scope trees carry 3 recorded rule violations** (whitelisted, fix when those trees migrate or are touched): `components/client-portal/metrics/performance/performance-view.tsx` ~L164 (mono number inside a running sentence), `components/lead-card.tsx` ~L25 (mono on an email string).
- **Un-migrated surfaces still render sans numerics** — apply the mono pass *when each migrates to Teal-Summit*, then delete its `scripts/check-labels-whitelist.ts` entry if listed: `components/clients/history-table/history-chart-dialog.tsx` (sans axis/date ticks), and `components/ui/table.tsx` (whitelisted TableHead). *(2026-08-05: `weekly-budget-indicator.tsx`, `calorie-skewing-day-row.tsx` and `nutrition-training-calories-display.tsx` are struck from this list — all three were deleted with the calorie-skewing sunset and the surplus-settings rewrite.)*
- **`exercise-insight.ts` emits the word "Stable" into the mono KPI value slot** (`exercise-kpi-strip`). Kept by dominant-case reasoning (the slot is numeral-dominant); a content-level fix belongs in the insight builder, not the class site.

---

## `useNutritionPlan` is not SWR, so nothing can invalidate it

Logged: 2026-08-05 (surfaced while wiring the builder's live target preview).

`hooks/use-nutrition-plan.ts` fetches `GET /api/clients/[id]/nutrition` with raw
`useState`/`useEffect`/`fetch` keyed on an internal `refreshKey` counter. It
predates CONVENTIONS §7 ("Use SWR for all new data fetching") and is worse than
the anti-pattern that section names: there is no cache to invalidate at all, so
**no other surface can refresh it** — only a caller holding the hook's own
`refetchNutrition`.

That already bit once. `ClientGoalEditor` is mounted *inside* the nutrition
drawer and its save revalidates only `/api/clients/{id}/goals`, so a goal edit
left the drawer's derived targets and drift banner stale. Fixed narrowly by
threading an `onSaved` callback through to `refetchNutrition`
(`drawer-form-body.tsx`), which is correct but does not generalise: the next
writer of client weight, goals, or metrics will have the same problem and no
invalidator to call.

Proper fix: migrate the hook to SWR with a co-located key builder + exported
invalidator, matching `useInvalidateNutritionCalendar`. Deferred because it is a
whole-tab change (every consumer of the hook's ~20 returned fields) rather than
part of the builder rework. Mitigating factor: none of the eight `TabsContent`
in `app/clients/[id]/page.tsx` sets `forceMount`, so Radix unmounts inactive
tabs and the effect re-runs on tab switch — the in-drawer editor was the only
writer that could never trigger a remount.

## Nutrition-calendar invalidation — uninstrumented caller-less routes

Logged: 2026-07-02 (class-wide SWR invalidation pass; see CONVENTIONS.md §7 "Nutrition calendar cache invalidation").

The routes below rewrite `nutrition_events` server-side but currently have **no web client caller**, so no success handler calls `useInvalidateNutritionCalendar`. If any of these gains a caller (web or RN), that caller MUST adopt the invalidator:

- `DELETE /api/clients/[id]/training/[planId]` (archive plan; cascades via `cascadeNutritionAfterTrainingChange`)

---

## Nutrition cascade — five defects recorded by the S1.1 narrow-scope re-land (two since closed by S1B.2)

Logged: 2026-08-11 (goals/blocks execution plan, Session 1 Task 1.1); updated same day by
Session 1B Task 1b.2 (nutrition plan versioning, migration 144), which closed defects 3
and 5 and partially resolved defect 2. The session-level *decisions* live in that plan
doc's §8 STATUS blocks; **this file is the durable record of the defects**, because the
plan doc is deleted when its workstream lands (its own §1 rule) and a defect filed only
there survives solely in git history.

- **Stale training-surplus tail after a plan deletion.** The two plan-clear routes
  (`DELETE /api/clients/[id]/training`, `DELETE …/training/[planId]`) cancel the plan's
  **entire forward event ray**, then cascade `{kind:"from"}`, which rebuilds only
  `[today, today+56]`. Nutrition rows exist out to `lastAnchor+56`, so days past the
  cascade horizon keep a `calorie_surplus_percentage` from training events that no longer
  exist — and after a full plan clear there may be no further training writes to sweep
  them, so "nothing would ever revisit it" is exact. **Closed by `3abbfa5`, re-opened by
  the `d58120c` revert, deliberately not re-closed by the rescoped re-land** (owner
  decision 2026-08-11: narrow paths only). Re-land recipe, already worked out in
  `3abbfa5`: `cancelFutureEventsForPlan` returns the max deleted date via
  `.delete().select("date")` (same round trip); the two routes thread it as an explicit
  `to`; `NutritionRegenScope`'s `from` arm regains `to?` and `resolveScopeDates` extends
  past the horizon when `to` exceeds it. `training_plans.effective_until` is NOT a
  substitute — it is NULL on placed plans.
- **The cascade swallows PER-VERSION regeneration failures** (partially resolved by
  S1B.2). The lookup half is FIXED: the version query's error is destructured, logged,
  and Sentried, so a failed read can no longer impersonate "client has no plan" — the
  loud break the versioned model would otherwise have tripped on its first chain. What
  REMAINS: each version's `regenerateFutureNutritionEvents` call is still caught into
  `captureApiError` (deliberate — the calling route's primary write already committed),
  so a route can return success over a stale slice of the calendar (CONVENTIONS §12
  tension, recorded). One visible cost: the coach hero derives `hasCurrentTargets` from
  the covering version (1b.3), so a swallowed regen failure shows a hero reporting the
  prescription while the client's day view shows the event hole — the divergence points
  at this entry. Fix shape: surface per-version failures to the caller (the
  orchestrator's `regenerateEventsOrThrow` shows the loud pattern).
- ~~**The client-scoped upsert can silently rewrite a foreign plan's event.**~~
  **CLOSED by S1B.2 (migration 144 versioning).** The from-arm DELETE is now
  client-scoped AND clamped to the version's own window, matching the upsert's
  `(client_id, date)` conflict key — the delete/upsert scoping asymmetry is gone. A row
  inside a version's window carrying another version's id (or NULL) being re-stamped to
  the covering version is now CORRECT behaviour, not corruption: the covering version
  owns its window by construction (gist-constraint-backed).
- ~~**A cascade flips a `logged` day back to `scheduled`.**~~
  **CLOSED 2026-08-26 — the premise was false and the behaviour is affirmed.** Nothing in
  the product writes `nutrition_events.status = 'logged'` (no service, RPC or trigger; a
  live probe of dev found every product row `scheduled` and only one seeded fixture year
  `logged`), so there was never a status to revert. What the cascade does do — rewrite a
  logged day's event targets — is the intended behaviour (owner decision):
  `upsertNutritionLog` re-snapshots the target from the current event on every food save,
  so a session moved onto or off a day changes what the client sees at their next save.
  Freezing logged days was designed and rejected: a frozen event would re-snapshot a
  training surplus onto a day whose session had left. ARCHITECTURE → "Training →
  Nutrition cascade" and the `status` bullet now say so.
- ~~**Baseline leak onto pre-`effective_from` days after a future-dated regenerate.**~~
  **CLOSED by S1B.2 (migration 144 versioning) — fixed by construction.** The premise
  ("there is no stored source for the old numbers") died with versioning: a queued save
  now closes the outgoing version at `new_start − 1` and inserts a new one, so the old
  prescription's template survives as the closed version's own daily-targets grid. The
  cascade fetches every active version overlapping its scope and hands each the same
  scope; `regenerateFutureNutritionEvents` clamps to the version's window, so a
  training edit inside the pre-window era rebuilds those days from THAT era's grid —
  never from the next prescription's. Pinned by the segmentation tests in
  `services/nutrition-event-service.test.ts` and the owner's original-leak browser
  smoke (Session 1B checklist item 1).

---

## Training builder week model — deferred tails (builder S2.5)

Logged: 2026-07-01.

- **`training_plans.frequency_per_week` CHECK (1..7) outlives the week model.** The column (migration 015) predates multi-week programs; a raw non-rest total across N weeks violates it at apply time. S2.5 clamps at derivation (`deriveFrequencyPerWeek` / `recomputePlanFrequency` store a per-week average clamped to 1..7) and defensively at the placement boundary (`library-placement-service.ts` `createTrainingPlanAtomic` call). **The CHECK is still live in migration 015 and both clamps must stay until it is dropped.** Its former nominated owner (CPEP 7.10a) was deleted with the roadmaps/phases removal (2026-07-25), so the entry currently has no owner. Treat as indefinitely open — do not drop it piecemeal, and do not remove either clamp on the assumption it is gone.
---

## Training builder progression — pre-existing read cap (builder S4)

Logged: 2026-07-03.

- **`getClientTrainingPlan`'s `training_exercises` read is uncapped** (`services/client-training-plan-service.ts` ~L140-148: one `.in("session_id", sessionIds)` select with no `.range()` paging). PostgREST silently truncates at ~1000 rows, so a long multi-week program (e.g. 52 weeks × 5 sessions × 8 exercises ≈ 2000 rows) would silently drop the tail exercises from the client plan view. Same class as the exercise-catalog cap fixed in `c0020a4` — page with a range loop keyed on the ordered columns. Pre-existing before S4, but duplicate-week progression makes long programs materially likelier.

---

## Training builder standalone sessions — deferred tails (builder S3)

Logged: 2026-07-02.

- **`DELETE /api/training/saved-sessions/[savedSessionId]` is not standalone-scoped.** `removeSavedSession` filters only `.eq(id).eq(coach_id)` (`services/coach-saved-session-service.ts`), so the nominally-standalone route can delete plan-attached sessions too (same-coach only; no cross-tenant exposure). (The caller-less `PATCH` handler and `updateSavedSession` were deleted in the 2026-08-26 dead-code sweep, commit 4.) Harmless today (the only DELETE caller is the builder library panel's session list, fed by `GET /api/training/saved-sessions`, which returns standalone rows only — the S4.5 Sessions page that previously owned this is now a redirect stub). `removeSavedSession` now backs exactly one route, so it can be scoped with `.is("saved_plan_id", null)` without breaking another caller, but scope the standalone route with `.is("saved_plan_id", null)` — via a scoped service variant, not by breaking the shared plan-attached callers — before any new caller appears. The S3 overwrite endpoint (`.../overwrite`) is correctly scoped already.

---

## Exercise columns with no authoring path — `superset_group` / `is_warmup`

- **`superset_group` has zero readers.** Every reference is serialize/map/write plumbing; nothing renders it. It round-trips through the columns and drafts and is displayed nowhere.
- **`is_warmup` is read but no longer written.** Its remaining render branches live in the client tracker (`components/client-portal/training/exercise-tracker-block.tsx`); its last writer (the legacy calendar drawer's add-exercise dialog, plus the drawer's exercise row) was deleted with the drawer in the placed-plan editing overhaul — the builder-grade tray authors warm-ups as per-set `set_type` inside `set_specs` instead.
- **Why neither is dropped:** removing either column needs a migration plus a data audit ("does anything readable still carry a non-default value?"), and `is_warmup` additionally needs its authoring surface and render branches retired first.
- **Rule until then:** keep splatting both fields at every clone/insert site — a write path that drops them silently rewrites existing prescriptions. Add no new UI for either.

---

## Plan amendment — deferred tails (placed-plan editing Job 2)

Logged: 2026-07-22.

- **Entry-point gating fetches the full amendment payload for one boolean.** `TrainingBuilderRightPanel` runs the amendment GET (via `usePlacedPlan`) on every Plans-subtab view just to read `isFullyPast` for the hero button's disabled state. The SWR key is shared with the amendment overlay, so opening the editor never double-fetches — but the payload is the whole plan (all exercises). Fine at current plan sizes; if it ever shows up in traces, add a lean `?summary=1` variant rather than a second endpoint.

---

## The amendment writer breaks "one active row per slot position" — FIXED

Logged: 2026-07-27. Found while scoping (and then not building) calendar/plan slot sync. **Fixed the same day**; kept as the record of what the shape was, because the surviving producer below writes the same shape from a different door.

**The fix.** The editor's lock model already treated an early-logged future slot as immutable while the writer treated it as replaceable — that disagreement WAS the bug, so the two now share one predicate. The writer computes `frozenPositions` from the same three clauses `computeLockedSlotUids` uses, keeps those rows, skips minting a replacement, passes them to the walk as `skipPositions`, and 422s a shrink that would drop one. Separately, `toSlotRows` makes the slot list explicit — one active row per coordinate — so an extra row from any other writer can no longer shift a position. Existing rows were NOT repaired (all 14 affected plans are archived and inert).

**The invariant.** A placed plan's active `training_sessions` rows ARE its ordered day-slots: position in `canonicalSortRows` order *is* the date-walk slot position (`plan-amendment-service.ts:106-124`), and `date(position) = effective_from + position`. Nothing enforces it — there is no unique index on `(plan_id, week_index, order_index)` and there cannot be one, because `cloneSessionForEvent` mints colliding coordinates deliberately (see below). The invariant is "one active row per slot position", NOT merely "no duplicate coordinates": a row that survives past the grid's end breaks the walk just as thoroughly without colliding with anything.

**What happens.** `amendPlacedPlanFuture` keeps any session row still referenced by a surviving event — `survivingEvents` matches `date < floor OR status <> 'scheduled'`, so a **future** row the client logged early is kept active (`plan-amendment-service.ts:459-477`). Step 8 then inserts a fresh row for **every** future position, including that one, at the same `order_index` / `week_index` (`:512-537`). Two shapes follow:

- **Same-size or growing grid** → the kept row's position is inside `[offset, sessions.length)`, so a fresh row lands on top of it: two active rows sharing a coordinate pair, permanently.
- **Shrinking grid** → the kept row's position is past the new grid end. No collision, but the row stays `is_active` (it is in `keepIds`, so `deactivateIds` at `:477` excludes it) and still inflates the active row count. `plan-amendment-service.test.ts:891` exercises both at once, leaving 9 active rows for a 7-slot plan.

**Why it matters.** The canonical sort tiebreaks on `created_at` then `id`, so once positions are wrong, which row owns which slot is an accident of insertion time. Four things follow, none of them visible to a coach:

- **The next amendment freezes the wrong rows.** The elapsed/future partition is `currentRows.forEach((row, position) => { if (position < offset) keepIds.add(row.id) })` (`:474-477`). `offset` is derived from dates, the positions from row order — so one extra row before the boundary shifts the partition by one, and rows the coach still owns get treated as history while history gets replaced.
- **The read-side window grows.** `calculatePlacementEndDate` derives it from the row count it is handed (`program-event-walk.ts:91-109`). The GET passes `sessionRows.length` (`plan-amendment-service.ts:301-305`) and the PUT's drift check passes `currentRows.length` (`:401-405`), so both inflate by one day per extra row — corrupting `isFullyPast`, the "this plan has already ended" 422, and the delete-candidate range that feeds the **drift token**. The save path is immune: `:444-448` passes `sessions.length`, the incoming grid, which `:426-435` has already hard-validated as canonical and a whole multiple of 7. So the rewrite itself does not slide dates.
- **The editor stops round-tripping and doesn't say so.** `placedPlanToDraft` takes its week-shaped path only when every `weekIndex` group is exactly 7 rows (`placed-serialize.ts:163`); an extra row breaks that, so the plan falls to the flat repack (`:172-186`), which discards the stored coordinates and re-lays positions on save. **This is where dates actually slide**: the repack pads up to the next multiple of 7, the coach saves that grid, `sessions.length` grows, and the window grows with it — compounding on every subsequent save. The confirm dialog warns about moved *events*, never about the grid being reshaped.
- **Two events can land on one date, past both guards.** Step 11 resumes the walk over the fresh rows (`:619-653`). At the kept row's position it emits an event carrying the FRESH session id, on the date the early-logged event already occupies. The upsert arbitrates on `(client_id, training_session_id, date)` (`program-event-walk.ts:75`) — different session id, so `ignoreDuplicates` does not fire — and migration 136's index is partial `WHERE status = 'scheduled'` while the surviving event is `completed`, so it does not fire either. `plan-amendment-service.test.ts:907` already demonstrates the emission; nothing asserts the collision. Compounding this, `rethrowIfDateOccupied` exists precisely to translate a `23505` from that upsert (`training-event-occupancy.ts:65-74` says so) but is never called on it — its only call sites are `library-placement-service.ts:584` and `training-event-calendar-service.ts:135` — so if the index ever did fire there, the coach would see raw Postgres text.

**Severity: real, live, and self-inflicted by a normal workflow.** Trigger is "client logs a future session early, coach then amends" — not an edge case. Measured against the live DB on 2026-07-27: **14 of 118 plans with active rows carry duplicate coordinates.** Worst case `88e76207`: 78 active rows over 42 distinct coordinates, with ten-way collisions at each of `(1,7)`, `(1,8)`, `(1,10)`, `(1,12)`. All 14 are `archived` today — archived plans can be neither amended nor resolved by either reader, so the existing rows are inert — but every one of them was `active` at the moment the duplicates were minted.

**Two green tests encode the bug.** `plan-amendment-service.test.ts:760` asserts 7 inserts *and* `:770` asserts the kept row stays active — i.e. the collision itself; `:891` asserts the shrink shape. Any fix must change them, and the commit that does needs to say so.

Independent of calendar behaviour — no move, duplicate or drop is involved.

---

## `place-from-library` has no server-side past-date guard on the session branch

Logged: 2026-07-27, found while fixing the calendar's drag gates.

`POST /api/clients/[id]/training/place-from-library` guards its `plan` branch and its `inline` branch against a past `targetDate` using `getClientTodayString`, but the `type: "session"` branch does not: it calls `placeSessionOnCalendar` directly, and that function only runs `assertDateFree` — an occupancy check, not a date check. The past-date rule for a library-session drop is therefore **client-side only** (`use-calendar-dnd.ts`, now correctly anchored on the client's day).

**Why it matters.** A crafted request writes a scheduled session into the past, and `deleteEvent` refuses to remove past events — the same stranded-row shape that had to be cleaned up with a script this morning, reachable without the UI. Nothing in the app sends such a request, so this is a hardening gap rather than a live defect; the fix is the two-line guard its sibling branches already have.

---

## The 'UTC' timezone sentinel resolves differently on each side

Logged: 2026-07-27, found while fixing the calendar's drag gates.

A stored `clients.timezone` of `'UTC'` means "never device-synced", and both sides fall back — to **different** zones:

- Client-side, `training-calendar-view.tsx` falls back to the **coach's device day** (`getTodayDateString()`).
- Server-side, `getClientTodayString` falls back to the coach's **stored** `coaches.timezone`, then to UTC.

For a coach whose device zone differs from their stored column (travel, or a coach row that has never synced) those two disagree, so a date the UI accepts can be one the server rejects — the same class of bug Job 3 just fixed one layer up. Compounding it, the sentinel is indistinguishable from a client genuinely in UTC (London in winter, Reykjavik, Accra), who therefore gets the fallback permanently rather than their real zone.

Scope only. Fixing it means either a real "never synced" marker distinct from the zone value, or one shared resolver both sides call.

---

## `cloneSessionForEvent` writes a row that is not a slot

Logged: 2026-07-27, split out of the entry above once the amendment writer was fixed.

**What happens.** The placed-session tray's "just this day" scope (`training-session-service.ts:200-244`) inserts a clone carrying the source row's `order_index` / `week_index` verbatim, repoints that one event at the clone, and leaves the original active. Two active rows now share a coordinate — by design, from a shipped feature. **This is why no unique index on `(plan_id, week_index, order_index) WHERE is_active` can be added**, and why `toSlotRows` exists instead.

**Reachability is narrower than it looks.** `requestSave` only offers the scope dialog when the row backs **more than one** future scheduled event (`placed-session-editor.tsx:116`); otherwise it saves in place and never clones. Under whole-program placement each slot backs exactly one date, so the dialog never appears. It takes a **per-event duplicate** first — `duplicateEvent` points the copy at the *same* `training_session_id` (`training-event-calendar-service.ts:110`) — or a legacy weekday-recurring plan. Measured on the live DB 2026-07-27: **zero non-archived plans carry duplicate coordinates.**

**Why it is still debt.** `toSlotRows` contains the damage (the extra row stops shifting positions, inflating the window, or breaking the editor's grid) but does not resolve the modelling question: a per-date override is not a day-slot, and nothing in the schema says so. The tie-break keeps the ORIGINAL row as the slot — correct, because after a duplicate-then-override the original still backs the slot's own date while the clone backs the duplicate's off-slot date — so the override stays a per-date thing and never becomes the slot's content. But the clone remains active, invisible to the editor, and referenced only by its event.

**The real question:** should `training_sessions` carry per-date override rows at all, or should a per-day edit be materialized onto the event (the way `nutrition_events.is_modified` already does for nutrition)? That is a design decision, not a patch. Related: `placeSessionOnCalendar` appends a dropped session at `(lastWeek, lastOrder + 1)` — out-of-band rather than colliding, but the same "row that is not a slot" shape.

---

## Draft assistant — untriaged review-fleet findings (builder S6a)

Logged: 2026-07-21 (Phase 7 sweep). Source: the 6a pre-commit adversarial fleet — 63 findings, 28 survived verification; the 4 HIGH + 6 MEDIUM were fixed in `56464f5`. **~18 LOW/unverified were never triaged** and live only in a workflow journal, which is not a durable location. Named here so the path doesn't rot.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No runtime validation of tool inputs | `services/assistant/draft-*-tools.ts` | `betaTool`'s `parse` is a passthrough — the JSON schema is advisory to the model, not enforced at execution. The only real guard is the client-side zod belt, which runs AFTER the server has mutated its workspace and narrated the turn, so a malformed input voids the whole turn instead of failing at the tool. Add per-tool zod parsing in the executor bodies — **which must stay synchronous** (see the sync-executor constraint below). | Open |
| 2 | Truncated tool call can execute on partial input | `services/assistant/draft-agent-service.ts` | `max_tokens: 16000`; a `tool_use` block cut off mid-JSON can reach an executor with a partial argument object. With #1 unfixed nothing rejects it. Check `stop_reason === "max_tokens"` before running a response's tools. | Open |
| 3 | Transcript history is not `asUntrusted`-fenced | `services/assistant/draft-agent-service.ts` | Only the live `command` is fenced. Prior turns replayed from the client-supplied transcript (≤24 × ≤4000 chars) enter the prompt unfenced, so an injection payload only has to survive one round trip to become unfenced context. | Open |
| 4 | Missing IP burst guard on the assistant route | `app/api/training/assistant/route.ts` | Unlike the client-portal two-tier pattern, this route has no IP-keyed first tier — only the post-auth coach-keyed `assistantRateLimit`. Documented as a deviation in CONVENTIONS §9; logged here so it is not mistaken for an endorsed pattern. | Open |
| 5 | Remaining ~15 LOW/unverified findings not read out | workflow journal | Read the journal, triage into this table or discard with a reason, before it is pruned. | Open |
| 6 | Owed verification from 6a | — | Live browser smoke of both assistant dock mounts, and `usage.cache_read_input_tokens` confirmed non-zero against the real API. Also still owed from earlier phases: manual smoke of 2.5-apply-to-client, 2.75, S3, and the full-screen client-draft apply. | Open |

**Two silent-failure constraints — do not "tidy" these:**
1. **Prompt-cache floor.** The cacheable tools+system prefix must stay above the model's cache minimum (4096 tokens on Opus 4.8). Below it the API caches nothing with **no error** — cost rises and no test fails. `services/assistant/prompt-size.test.ts` guards the size; the telemetry's `cacheEngaged` flag is the live check. Shortening the system prompt is a cost regression nothing will announce.
2. **Tool executors must stay synchronous.** The SDK runs a response's tool calls through `Promise.all` and the prompt encourages batching; that is safe only because a sync body gives the event loop no interleave point while mutating the shared workspace. Adding an `await` inside any tool `run` lets batched calls clobber each other. This is currently unreachable because the assistant never reads the DB (the catalog is preloaded once per turn) — a future tool needing a DB read must either serialize tool execution first or preload its data the same way.

---

## Deployment prerequisite — assistant route needs a >240s function timeout

Logged: 2026-07-21 (Phase 7 sweep). **Not debt so much as an undeclared requirement.**

- `app/api/training/assistant/route.ts` exports `maxDuration = 300`, deliberately above the SDK client's 240s timeout so a long turn fails as a handled SDK timeout rather than an opaque platform kill. **There is no `vercel.json` and no `.vercel/` in the repo**, so nothing declares this to a host.
- Any platform capping functions below 300s (Vercel Hobby is 60s) will kill long turns mid-flight; to the coach it presents as "the assistant is broken", not as a timeout. Raising either number means raising both.
- **This has never been exercised against a real platform ceiling** — the longest recorded turn (~5 minutes, from the 6a record) ran locally. Add a `vercel.json` when a deploy target is chosen, so the requirement is version-controlled rather than tribal.

---

## Pre-deploy gate — service-role key must not reach the client bundle

Logged: 2026-07-30. **Not debt so much as an unenforced invariant**, now enforced by a script but not yet by CI.

- **The gate.** `npm run check:service-key` (`scripts/check-service-key-leak.ts`). Two clauses, each with its own positive control, because a grep that finds nothing and a grep that is silently broken look identical:
  1. **Import graph** (no build needed, runs today). Walks the reverse import graph upward from `services/supabase-admin.ts` following **value imports only**, and fails if any `"use client"` module is reachable. Control: the closure must still reach an `app/api/**` route — if module resolution breaks, the closure collapses to 1 and "no client modules" would be a meaningless pass.
  2. **Bundle scan** (needs a build). Greps browser-served static output for the key's value, its bare JWT signature segment (catches a re-encoded or chunk-split value), and the literal `SUPABASE_SERVICE_ROLE_KEY`. Control: the **anon key must be found** — if it is not, the scan is not reading real chunks and the result is `INCONCLUSIVE` (exit 2), never a pass.
- **Why it exists.** Containment rests entirely on two conventions that nothing enforced: that Next.js only inlines `NEXT_PUBLIC_*`, and that every client-side edge into a service module stays `import type`. **The second is one keystroke from breaking.** 17 client files type-import a service that value-imports `supabaseAdmin` (`app/client/program/page.tsx:10`, `app/clients/page.tsx:15`, `hooks/use-placed-plan.ts:5`, `components/.../placed-serialize.ts:10`, …). Deleting the word `type` in any one of them drags the service-role client into the client graph, and **neither `tsc` nor eslint objects**. Mutation-tested 2026-07-30: removing `type` from `hooks/use-placed-plan.ts:5` alone pulled **17 client modules** into the closure — the gate caught it, exit 1.
- **2026-07-30 baseline (development build only).** Value-import closure = 320 files (177 API routes, 76 services, 55 tests, 10 scripts, `app/auth/callback/route.ts`, `lib/require-coach-auth.ts`); **0 client modules, 0 hooks, 0 components**. Bundle scan of `.next/dev/static` = 187 files, 0 hits on value / signature / var name, anon-key control found. Two benign near-miss strings confirmed by hand: a source comment mentioning `supabaseAdmin` in a `.js.map`, and `service_role` inside `@supabase/auth-js`'s own JSDoc warning.
- **OWED BEFORE FIRST DEPLOY.** The baseline above is a **dev** build — no production build has ever been inspected, because there is no deployment yet. Run `npm run build && npx tsx scripts/check-service-key-leak.ts --require-bundle` before the first deploy. `--require-bundle` deliberately **rejects a dev bundle** (`.next/dev/static`) and demands `.next/static`, and fails rather than skipping when no build is present — so it cannot pass vacuously.
- **OWED AFTER: CI wiring.** There is **no CI in this repo** — no `.github/`, no GitLab/CircleCI config, no `vercel.json`. The script is written CI-ready (reads the key from `process.env` first, falls back to `.env.local`; never prints the secret, only lengths and paths). When CI is introduced, run clause 1 on every PR (it needs no build and no secrets) and the full gate with `--require-bundle` on the deploy job.

---

## `SET_TYPE_OPTIONS` is not in `utils/set-spec-edits.ts`

Logged: 2026-07-21 (Phase 7 sweep). A trap for whoever collapses the re-exports.

- The exec plan asks a future session to collapse `use-set-spec-mutations.ts`'s re-exports onto direct `utils/set-spec-edits` imports at the call sites. **`SET_TYPE_OPTIONS` is defined in `use-set-spec-mutations.ts` and does not exist in `utils/set-spec-edits.ts`** (it is UI label data, not edit logic), so a blanket find-and-replace fails `tsc`. S7 removed the one genuinely unused re-export (`MAX_DROPS`); the 2026-08-25 dead-code sweep removed the two value re-exports (`MAX_SET_SPECS`, `applySetSpecEdit`) and repointed their three test importers at `utils/`. Only the `SetSpecEdit` type re-export remains, with six product importers.

---

## Events-as-SOT overhaul — test coverage gap

- **`create_training_plan_atomic` (mig 114) real-effect coverage.** Session 2◆1 rewrote the RPC to be additive (window-bounded delete + provenance insert). The vitest suite mocks `supabaseAdmin`, so the RPC's actual DELETE/INSERT — window-bound, coexistence of disjoint plans, idempotent re-place, overlap "incoming wins" — has **no automated coverage**. Correctness currently rests on the manual smoke (place A Jan + B Mar disjoint → both survive; place B overlapping A → B wins contested, A's pre-overlap survives; re-place same range → event count stable). **Owe a focused local-supabase RPC test no later than Session 5** (where seed/backfill already needs DB-level validation). Same gap applies to `getNextPlanStartCap`'s cross-plan cap. Decided 2026-06-18 (no pgTAP/Postgres infra before launch — consistent with the mock-everything architecture + deferred-tooling stance).

---

## Pre-launch Security Checklist (from 2026-06-10 audit)

Items deliberately deferred or remaining after the 2026-06-10 security remediation pass (migrations 105–108 + code fixes — see "Known RLS Gaps"). Address before public launch.

- **Rate limiter fails OPEN on a slow Redis (2026-07-22).** None of the four `new Ratelimit({...})` sites in `lib/rate-limit.ts` (`:136`, `:268`, `:320`, `:374`) passes a `timeout`, so `@upstash/ratelimit`'s 5s default applies — and on timeout it *resolves* `{ success: true, reason: "timeout" }` rather than throwing. The limiter therefore admits everything, and the `try/catch` that would have fallen back to the in-memory path never fires. Fix: pass `timeout: 0` (forces a real rejection into the existing catch) or check `result.reason === "timeout"` and fail closed on the AI/assistant tiers. This is the only control standing between open self-serve signup and paid model spend, so it gates the launch spend story.
- **No durable per-coach AI spend cap.** `assistantRateLimit` is a 20-request/5-minute bucket keyed per coach with no token or dollar ceiling behind it, and the token counters in `services/assistant/draft-agent-service.ts` are `console.info` telemetry, never persisted or checked. Mitigated for launch by disabling the builder assistant; **re-check before re-enabling it.** Note the check-in review path (`services/ai-service.ts`, OpenAI) is a second paid surface and is not covered by that mitigation.
- **Rate-limit identity is the raw leftmost `X-Forwarded-For`** (`lib/rate-limit.ts:97-101`) with no trusted-proxy validation, so every IP-keyed tier is evadable by rotating the header, and a victim's IP can be pinned to lock them out. Use the platform's trusted client IP once deployed.

- **Invite-accept email match (deferred by owner — intentional).** `acceptInvitationByToken` (`services/invitation-service.ts`) does NOT verify `user.email === invitation.email`, and `POST /api/invitations/accept` (token branch) trusts a body-supplied `userId`. Retained on purpose so fake-email variants can be run through onboarding while Resend is limited to a single verified address pre-domain-registration. **Re-enable** the email check (mirror the legacy `clientId` branch's `getUserById` + email compare, or derive the principal from the server session) once the sending domain is verified. Until then, possession of a valid invite token + a self-signup lets an attacker bind the client record to an account under their own email.
- **`captureApiError` coverage (~9/144 routes).** Most handled route errors never reach Sentry. Finish via planned sessions 9.3 / 9.9 rather than a separate sweep.
- **Dependency follow-ups (transitive, non-production-hot-path).** The `next` bump to 16.2.9 cleared the SSRF (8.6) + middleware/route-param bypass highs. `npm audit` still reports: dev-only `vitest`/`@vitest/coverage-v8` (critical — UI server arbitrary file read/exec), `vite`/`fast-uri`/`picomatch`/`ws`/`brace-expansion` (build/test tooling), and `uuid`/`postcss`(bundled under `next`)/`svix` moderates via `resend` + `@sentry`. Run `npm audit fix` opportunistically and re-bump after the next `next`/`resend`/`@sentry` releases.
- **CSP nonces.** `script-src` still uses `'unsafe-inline' 'unsafe-eval'` (Next.js requirement). Move to nonce-based CSP for production (Production Readiness L #5). `base-uri`/`form-action` were added 2026-06-10.
- **Upload content sniffing depth.** Magic-byte checks were added for images + PDF (`lib/upload-validation.ts`); office docs (docx/xls) and plain text are gated by the MIME allowlist only (no reliable magic number). Add a dedicated content-type library if richer formats are accepted later.
- **Backups / restore + uptime alerting.** Supabase-managed; confirm PITR/backup retention and add external uptime + alerting beyond Sentry error capture. (Infra, not code.)
- **Still open in Auth P0:** account-level lockout (#8) and email verification (#7, blocked on production domain).
- **Service-role key containment is verified only against a dev build.** Run `npm run build && npx tsx scripts/check-service-key-leak.ts --require-bundle` before the first deploy — see "Pre-deploy gate — service-role key must not reach the client bundle" above.

---

## Authentication & Authorization

Reviewed: 2026-03-12

### P0 - Security

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Middleware uses `getSession()` instead of `getUser()` | `middleware.ts:49,90` | `getSession()` reads the JWT from cookies without server-side validation. Supabase docs recommend `getUser()` for security-sensitive route protection as it validates the token server-side. A tampered/expired JWT could pass middleware checks. Violates §1, §9. | Done |
| 2 | Dangerous default role fallback | `middleware.ts:106` | `const role = profile?.role \|\| "trainer"` - if profile fetch fails (DB error, network issue), user silently gets trainer-level access. Should deny access instead. Violates §3, §9. | Done |
| 3 | No `requireClientAuth` guard | `lib/require-coach-auth.ts` | Coach routes have a shared `requireCoachAuth()` guard but no equivalent exists for client routes. Each client route implements its own auth check, risking inconsistency. Violates §2 "No duplicate logic". | Open |
| 4 | Auth callback route missing rate limiting | `app/auth/callback/route.ts` | The OAuth callback endpoint has no rate limiting. All other auth-related routes are properly rate-limited. Violates §9 "Rate limiting: MANDATORY". | Done (apiRateLimit added, security pass 2026-06-10) |
| 5 | Invitation token endpoint uses wrong rate limit tier | `app/api/invitations/[token]/route.ts` | Uses `apiRateLimit` (60/min) instead of `authRateLimit` (5/15min). This is a public endpoint that reveals invitation details and could be used for token enumeration. | Done |
| 6 | Inconsistent password minimum length | `app/reset-password/page.tsx:35`, `lib/validations/auth.ts:30` | Signup and invite signup require 8-char minimum. Password reset allows 6-char minimum. Users can downgrade password strength via the reset flow. | Done |
| 7 | No email verification enforcement | `contexts/auth-context.tsx` | Users can sign up and immediately access the app without verifying their email. Supabase supports email verification but it's not gated in the auth flow. **Blocked** until production domain is live (Supabase email verification requires verified sender domain). | Open |
| 8 | No account-level lockout after failed login attempts | `lib/rate-limit.ts` | Rate limiting protects at the IP level (via `authRateLimit`), but there's no per-account lockout. An attacker distributing attempts across IPs could still brute-force a specific account's password. | Open |

---

### P1 - File Size Violations

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `contexts/auth-context.tsx` | 512 | 300 | 212 (71%) | Resolved 2026-07-24 — now 247 lines |

**Suggested splits:**

1. **`contexts/auth-context.tsx`** - Resolved 2026-07-24, via a different shape than suggested: profile/coach fetching moved **server-side** (`services/auth-profile-service.ts` + `GET /api/auth/me`, consumed via SWR) rather than a browser-side extraction, which also removed the supabase-js Navigator-lock deadlock (`fetchProfile timeout`) at the root. The visibility/storage handlers were **deleted, not extracted** — the storage handler was dead code (sessions live in cookies; `document.cookie` writes never fire `storage` events) and GoTrueClient's own visibilitychange listener + BroadcastChannel cover cross-tab sync — so no `hooks/use-session-sync.ts` exists.

---

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Duplicate Supabase server client factories | `lib/auth-helpers.ts:5-28`, `lib/supabase-server.ts:8-29` | `createSupabaseServerClient()` and `createServerSupabaseClient()` are nearly identical functions with confusingly similar names. Consolidate into one. Violates §2 "No duplicate logic". | Open |
| 2 | `CoachRow` type defined locally | `contexts/auth-context.tsx:37-45` | Resolved 2026-07-24, with a correction: the claim was doubly stale — auth-context had long since switched to importing `CoachRow` from `lib/database-helpers`, and `coaches` IS in the generated types. The auth bootstrap refactor removed the context's table reads entirely. | Resolved |
| 3 | Pervasive type assertions | `contexts/auth-context.tsx:92,114-116,125,149,174` | Resolved 2026-07-24, with a correction: `profiles` and `coaches` ARE in the generated `Database` type (no regeneration needed — the "missing tables" claim was stale). The cast sites died with the deleted browser-side table reads. One narrow cast survives in `services/auth-profile-service.ts` (`role: string` → `UserRole`, backed by the DB CHECK constraint). | Resolved |
| 4 | `ClientRow` type defined locally | `app/api/invitations/send/route.ts:9-15` | Same issue as #2 - inline type instead of shared from `/types`. | Open |
| 5 | Deprecated `acceptInvitation` still called | `app/auth/callback/route.ts`, `services/invitation-service.ts:364` | The unauthenticated `/auth/callback` caller (an account-takeover vector — it linked a URL-supplied `clientId` to the session with no checks) was **removed** in the 2026-06-10 security pass. `acceptInvitation` now has only ONE caller: the legacy `clientId` branch of `POST /api/invitations/accept`, which verifies `invitedUser.email === invitation.email` first. Remaining work is purely cosmetic (delete the deprecated fn + legacy branch). | Partially resolved (takeover path removed) |
| 6 | Legacy clientId-based acceptance still maintained | `app/api/invitations/accept/route.ts:42-81` | The deprecated code path adds ~40 lines of complexity. If `acceptInvitation` (#5) is migrated, this entire branch can be removed. | Open |
| 7 | `invitation-service.ts` imports browser client | `services/invitation-service.ts:1` | `getInvitationForClient()` uses the browser Supabase client. If called server-side, this will fail or bypass proper auth. Should use admin or server client. Violates §1. | Resolved — the file has imported `supabaseAdmin` for some time, and `getInvitationForClient` itself (no caller) was deleted in the 2026-08-25 dead-code sweep. |
| 8 | Login fetches profile twice | `contexts/auth-context.tsx:384-388` | Resolved 2026-07-24 by the auth bootstrap refactor: `login()` now makes exactly one `GET /api/auth/me` call, primes the SWR cache from it, and returns the role from the same response. | Resolved |
| 9 | `error: any` in auth pages | `app/forgot-password/page.tsx:31`, `app/reset-password/page.tsx:55` | Both use `catch (error: any)` while login and signup correctly use `catch (error: unknown)` with `instanceof Error` checks. Violates §5. | Open |
| 10 | Forgot-password and reset-password skip Zod validation | `app/forgot-password/page.tsx`, `app/reset-password/page.tsx` | Both use raw `useState` with manual validation, while login/signup use `react-hook-form` + `zodResolver`. Violates §11, §3. | Open |
| 11 | Manual cookie parsing in browser client | `services/supabase-client.ts:21-63` | `createBrowserClient` handles cookies automatically by default. The manual `document.cookie` parsing is unnecessary and a potential source of bugs. Violates §1. | Open |
| 12 | Duplicated auth page layout/background | `app/login/page.tsx`, `app/signup/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/invite/[token]/page.tsx` | All 5 auth pages duplicate the same animated orb background, card wrapper, and Framer Motion pattern. Extract to a shared `AuthLayout` component. | Open |
| 13 | Magic link onboarding check uses unset metadata | `app/auth/callback/route.ts:67` | `!user.user_metadata?.password_set` - this metadata field is never set anywhere in the codebase, so `needsOnboarding` is always `true` for clients via this path. Dead code that silently misdirects users. | Open |

---

### P3 - Cleanup

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | ~25 console.log debug statements | `contexts/auth-context.tsx` | Resolved 2026-07-24 (was already stale — the file carried `console.error` only). The rewrite keeps error/warn logging only. | Resolved |
| 2 | Stale closure in visibility change handler | `contexts/auth-context.tsx:319-322` | Resolved 2026-07-24 by deletion: the hand-rolled visibility handler (and the dead `storage` handler) were removed in the auth bootstrap refactor — supabase-js's own visibilitychange handling + BroadcastChannel cover cross-tab sync. | Resolved |

---

## Client Onboarding Flow

Reviewed: 2026-03-12

### P1 - File Size Violations

These files exceed the limits defined in CONVENTIONS.md Section 4 and should be split.

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `services/check-in-tracking-service.ts` | 455 | 300 | 155 (51%) | Open |
| 2 | `app/client/dashboard/page.tsx` | 366 | 250 | 116 (46%) | Open |
| 3 | ~~`components/check-in/check-in-detail-modal.tsx`~~ | 352 | 250 | 102 (41%) | **Resolved 2026-08-29** — deleted; the review surface is `components/clients/check-ins/check-in-detail-view.tsx` (234 lines, render only) over the SWR hook `hooks/use-check-in-detail-data.ts` (228 lines) |
| 4 | `app/api/client/check-ins/route.ts` | 292 | 250 | 42 (17%) | Open |
| 5 | `app/client/check-in/page.tsx` | 290 | 250 | 40 (16%) | Open |
| 6 | `components/daily-pulse/daily-pulse.tsx` | 277 | 250 | 27 (11%) | Open |
| 7 | `components/client/walkthrough/guided-walkthrough.tsx` | 266 | 250 | 16 (6%) | Open |
| 8 | `lib/date-utils.ts` | 221 | 150 | 71 (47%) | Open |
| 9 | `utils/daily-logs-aggregation.ts` | 185 | 150 | 35 (23%) | Open |

**Suggested splits:**

1. **`check-in-tracking-service.ts`** - Split into `check-in-overdue-service.ts` (overdue/due-soon detection) and `check-in-adherence-service.ts` (streak calculations, adherence stats). Currently mixes unrelated concerns: overdue severity, upcoming detection, streak counting, and adherence statistics.

2. **`dashboard/page.tsx`** - Extract a `useDashboardData()` hook to handle the 6-endpoint `Promise.all` fetch and associated state management. The page component should only own layout and rendering.

3. ~~**`check-in-detail-modal.tsx`** - Extract tab content panels into sub-components~~ — **RESOLVED 2026-08-29**: the modal was deleted when the review moved onto the client's Check-ins tab (`components/clients/check-ins/check-in-detail-view.tsx`); its data fetches and state now live in the SWR hook `hooks/use-check-in-detail-data.ts`, and the view only renders.

4. **`check-ins/route.ts`** - Extract photo upload handling and AI summary triggering into the check-in service layer. The POST handler has too many inline responsibilities.

5. **`check-in/page.tsx`** - Extract step navigation logic and `canProceed()` validation into a `useCheckInSteps()` hook.

6. **`daily-pulse.tsx`** - Split into `DailyPulseContainer` (hooks, state, handlers) and `DailyPulseView` (JSX rendering).

7. **`guided-walkthrough.tsx`** - Extract individual step content renderers into a `walkthrough-steps.tsx` sub-component.

8. **`date-utils.ts`** - Move check-in-specific functions (`calculateCheckInPeriod`, `getCheckInStatus`, `getNextPeriodEnd`) to a new `lib/check-in-date-utils.ts`.

9. **`daily-logs-aggregation.ts`** - Split metric averaging into a separate `utils/metric-averages.ts`.

---

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Duplicate constant | `lib/date-utils.ts` | `DAY_MAP` defined twice (lines 50-58 and 129-137). Extract to a single module-level constant. | Open |
| 2 | Hardcoded magic numbers | `services/check-in-tracking-service.ts` | `-3` days upcoming threshold, `frequencyDays + 2` tolerance (lines 262, 311). Extract to named constants. (The `7`-day grace window went with `getMissedCheckInPeriods` in the 2026-08-25 dead-code sweep.) | Open |
| 3 | Hardcoded magic numbers | `components/check-in/daily-logs-summary.tsx` | Wellness thresholds for all 5 metrics (mood 3/4, stress+soreness 3/6, energy/sleep 5/7) and the per-metric score divisors. Extract to `lib/constants.ts`. | Open |
| 4 | Hardcoded magic numbers | `components/check-in/step-subjective.tsx` | Minimum logs threshold `3` (line 29), default metric values of `5`. | Open |
| 5 | Hardcoded magic numbers | `services/client-check-in-service.ts` | `6` days offset (line 66), `1.2` TDEE sedentary multiplier (line 146). | Open |
| 7 | Unsafe type casts | `lib/mappers.ts` | Lines 37-38 cast raw DB JSON to `AIInsight[]` and `AIRecommendation[]` without runtime validation. Add Zod schemas or type guards. | Open |
| 8 | Empty catch blocks | `components/client/walkthrough/guided-walkthrough.tsx` | Line 76: catch block with only a comment, no logging. Should at minimum `console.warn`. | Open |
| 9 | Empty catch blocks | `components/coach/client-activation-dialog.tsx` | Lines 87, 111: errors are logged but not surfaced to the user via toast. | Open |
| 10 | Incomplete error handling | `app/client/dashboard/page.tsx` | `Promise.all` fetches 6 endpoints but failure in one leaves all state undefined. Should handle per-endpoint failures independently. | Open |
| 11 | Unmemoized handler factories | `components/daily-pulse/daily-pulse.tsx` | Lines 208-210: `createAddHandler`, `createRemoveHandler`, `createToggleHandler` recreated every render. Wrap in `useCallback`. | Open |

---

## Daily Pulse Feature

Reviewed: 2026-03-12

### P1 - Bugs

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Wrong date for unplanned activities | `components/daily-pulse/utils/daily-pulse-handlers.ts:84` | `saveUnplannedActivities` hardcodes `new Date().toISOString().split('T')[0]` instead of using the selected date. Saving unplanned activities on a past date incorrectly logs them for today. Fix: pass `selectedDate` as a parameter. | Open |

---

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Duplicate type: `HabitLogWithDetails` | `daily-pulse-content.tsx`, `habits-section.tsx`, `use-daily-pulse.ts`, `use-daily-pulse-state.ts`, `daily-pulse-logged-view.tsx` | Defined independently in 5 files. Canonical export exists in `types/daily-habit.ts`. All other files should import from there. | Open |
| 2 | Duplicate type: `TodaysActivity` | `daily-pulse-content.tsx`, `training-summary.tsx`, `daily-logs-service.ts`, `use-daily-pulse.ts` | Defined in 4 files. Extract to `types/daily-log.ts` and import everywhere. | Open |
| 3 | Duplicate type: `UnplannedActivity` | `daily-pulse-content.tsx`, `training-summary.tsx`, `nutrition-tracking-helpers.ts`, `add-activity-form.tsx` | Defined in 4 files. Extract to `types/daily-log.ts` and import everywhere. | Open |
| 4 | Silent error swallowing | `components/daily-pulse/utils/daily-pulse-handlers.ts:55-57, 90-92` | `handleSessionCompletion` and `saveUnplannedActivities` catch errors with only `console.error`. No user-facing toast. Violates CONVENTIONS "Never swallow errors silently". | Open |
| 5 | Duplicated row-to-model mapping | `services/daily-logs-service.ts` | Identical snake_case-to-camelCase mapping repeated 3 times. Extract a `mapRowToDailyLog(row: DailyLogRow): DailyLog` helper. **RESOLVED 2026-05-21 (Session 3.1)** — the duplication was already collapsed into one mapper; renamed it to the exported `mapRowToDailyLog` and added a direct unit test. | Resolved |
| 6 | Inconsistent date string handling | `components/daily-pulse/habits-section.tsx:83`, `components/daily-pulse/daily-pulse.tsx:40` | Uses `.split('T')[0]` instead of existing `getDateString()` from `lib/date-helpers.ts`. | Open |
| 7 | Undocumented eslint-disable | `hooks/use-training-restoration.ts:92` | Suppresses `react-hooks/exhaustive-deps` without a "why" comment. CONVENTIONS require commenting the why (Section 3, line 82-83). Audit deps and add rationale or fix. | Open |

---

### P3 - Test Coverage

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No tests for daily pulse hooks | `hooks/use-daily-pulse.ts`, `hooks/use-daily-pulse-state.ts`, `hooks/use-training-restoration.ts` | 3 hooks with ~500 lines of logic and zero test coverage. CONVENTIONS require 70% minimum (Section 12). | Open |
| 2 | No tests for handler utilities | `components/daily-pulse/utils/daily-pulse-handlers.ts`, `daily-pulse-event-handlers.ts`, `nutrition-change-handlers.ts` | Pure functions with no tests. These are easily testable without component mocking. | Open |

---

## Client Onboarding Flow (previous section)

### P3 - Test Maintenance

| # | Issue | File | Details | Status |
|---|-------|------|---------|--------|
| 1 | File size violation | `__tests__/helpers/mock-data-builders.ts` | Was 418 lines (67% over the 250-line limit); the 2026-08-25 dead-code sweep deleted nine importer-less builders, leaving 182 lines (the four builders tests actually use). | Resolved by deletion |

---

## Known RLS Gaps (Tech Debt)

> ⚠️ **Threat-model correction (2026-06-10).** "RLS is only defense-in-depth because service_role bypasses it" is true for the *app*, but NOT a reason to tolerate permissive policies. The public anon key ships in the browser and a logged-in user holds an `authenticated` JWT, so anyone can call PostgREST (`/rest/v1/...`) **directly**, bypassing the route layer. For any object reachable that way, RLS is the *only* perimeter. The security pass below was a direct consequence.

- **`daily_logs`** - Done. RLS enabled in migration 051. All 8 code paths confirmed to use supabaseAdmin (bypasses RLS). Policies added for defense-in-depth.
- **`check_ins`** - Hardened 2026-06-10 (migration **105**). The earlier "Done" note was WRONG: migration 050 enabled RLS but left the permissive `"Authenticated users can view/update check-ins"` policies from migration 003 in place, so any authenticated user could read/update EVERY tenant's health data via the anon-key PostgREST endpoint. Migration 105 drops those; only the client-scoped policies from 026 remain. Coaches read/respond via service_role.
- **`check_in_tokens`** - **TABLE DROPPED 2026-08-06 (migration 142)** — the magic-link check-in flow it served is deleted, so this row is history, not current state. Kept as a record: hardened 2026-06-10 (migration **105**) after the permissive `"Authenticated users can view tokens"` policy (migration 003) was found never to have been dropped — any authenticated user could harvest other clients' magic-link tokens. There is no longer an unauthenticated check-in path.
- **`SECURITY DEFINER` atomic RPCs** - Hardened 2026-06-10 (migration **106**). `upsert_daily_log_atomic`, `create_nutrition_plan_atomic`, `create_training_plan_atomic`, `transition_phase_atomic` (history — dropped with the roadmaps/phases removal, migration 133), `archive_roadmap_atomic` retained Postgres' default `PUBLIC` execute and took caller-supplied ids with no internal authz → cross-tenant writes via `/rest/v1/rpc/`. 106 REVOKEs PUBLIC/anon/authenticated, GRANTs service_role only, and pins `search_path`. (The two phase RPCs were dropped by migration 133; the two placement RPCs were re-locked at their new arities there.)
- **`training_events`, `exercises`, `coach_saved_plans`, `coach_saved_sessions`, `coach_saved_exercises`** - Hardened 2026-07-21 (migration **122**). All five were created with **no `ENABLE ROW LEVEL SECURITY` and no policies** (075:4, 083:5, 084:6/27/46) and stayed that way for 47 migrations. Verified live before the fix: the browser-shipped anon key, with **no login**, returned 540 / 1597 / 28 / 164 / 275 rows. RLS now enabled with zero policies (deny-all); all access is service_role. `GRANT ALL … TO anon` is deliberately left in place — RLS covers everything PostgREST exposes; the residual is `TRUNCATE` (not subject to RLS) and introspection, neither REST-reachable.
- **`attention_dismissals`, `coach_client_views`** - Hardened 2026-07-21 (migration **125**). Both carried `FOR ALL TO authenticated USING (true) WITH CHECK (true)` — created *after* migration 105 had already established why that shape is wrong, because `CONVENTIONS.md` still prescribed it. Now deny-all.
- **`storage.objects` (progress-photos bucket)** - Hardened 2026-07-21 (migration **126**). Two policies existed **only as Studio drift, in no migration**, both with no `TO` clause (→ PUBLIC → anon). Verified live: an unauthenticated caller listed the private bucket, downloaded a real photo (HTTP 200, 60,696 bytes), and created an object. A source-only audit could not have found these.
- **How to check this list is still true:** `npm run check:rls`. It reads the live catalog (not the migration tree) and asserts RLS on every public table, no trivially-true policy for `authenticated`, no anon-reachable policy whose qual ignores the caller, and `security_invoker` on every view. The tree is not trustworthy here — see the two drift incidents recorded below.

### Opened by the 2026-07-21 database audit (not yet fixed)

- **Studio drift is real and it defeats `DROP POLICY IF EXISTS`.** Twice in one workstream the live catalog disagreed with the tree: `daily_logs_full` was already `security_invoker` in prod though no migration said so, and the content-library client storage policy had been recreated under the text of migration 029's *comment* line (`"Clients can view files from their coach"`) rather than its `CREATE POLICY` name (`"Clients can view their coach's content"`). Migration 125 dropped the source name and **silently did nothing** — a successful push does not mean a policy was removed. **Always verify a policy drop against a fresh `supabase db dump`, never against the push exiting 0.**
- **Six dead coach policies on `storage.objects`** (029:297-331 plus drifted Studio duplicates under a second naming scheme). Unused — there are zero non-admin `.storage` calls in the repo; both buckets are reached only via `services/content-storage-service.ts` and `services/storage-service.ts`, both on `supabaseAdmin`. Deliberately left in place by migration 126 rather than bundling hygiene into a security push. Safe to drop in a cleanup sweep.
- **Edge cache outlives RLS.** Storage uploads set `cacheControl: "3600"` (`services/storage-service.ts`, `services/content-storage-service.ts`) and the CDN serves objects `cache-control: public, max-age=3600` keyed on path. Any private object fetched while a policy was open stays retrievable from the edge for up to an hour **after** the policy is fixed — observed directly when validating migration 126 (`cf-cache-status: HIT` on an object whose authorization had already been revoked; a cache-busted request correctly returned 400). RLS is therefore not the whole control for storage. Consider a shorter TTL or `private` cache-control on the private buckets.
- **Attention feed `.in(clientIds)` request-line ceiling.** Paging (fixed 2026-07-21) does not address this: the feed inlines every client id into five `.in()` filters, ~37 B/UUID, so the request line grows past gateway limits on a large roster and the feed fails outright. Needs a server-side aggregate (RPC), not paging.
- **`CREATE INDEX CONCURRENTLY` is unreachable from a migration file** — see the runbook in `docs/ARCHITECTURE.md`. Zero of 116 index builds use it. Harmless so far because each index was created in the same migration as its (empty) table, but any index retro-fitted onto `set_logs` / `training_exercises` / `exercise_logs` once they pass ~1M rows is a full write outage of that table for the duration of the build.
- **RPC surface not re-verified against the live catalog.** The audit's grant/overload conclusions (§3) are all reasoned from migration order; live `pg_proc.proacl` / `proconfig` were never read, and the two orphaned `upsert_daily_log_atomic` overloads (6-arg 057:7, 8-arg 059:18 — zero callers, both BYPASSRLS) are still presumed present. `npm run check:rls` does **not** cover functions.

### Opened by the 2026-07-30 anon-path read trace (not yet fixed)

> Context: a full read-path trace (every Supabase client factory enumerated, every `.from()` receiver resolved) established that the app has **two** data paths, not one. Service_role covers 185/185 call sites on the 14 deny-all / broken-policy tables, but a second anon-key + RLS path is load-bearing for six of them — enumerated in the `assert-rls.ts` entry below, which is where that list should permanently live.
>
> ⚠️ **Before dropping any policy: check whether it is PERMISSIVE or RESTRICTIVE.** They compose in opposite directions — permissive policies are OR'd together, so dropping one *narrows* access, while restrictive policies are AND'd, so dropping one *widens* it. A "remove the dead policy" sweep that does not distinguish them can silently open a table while appearing to tighten it. Confirm the mode from `pg_policies.permissive` against a fresh live dump, not from the migration that created it.
>
> Verified 2026-07-30: **all 114 live policies are PERMISSIVE; there are currently zero RESTRICTIVE policies.** So today every drop narrows access, and the hazard above is forward-looking — it becomes live the moment anyone adds the first RESTRICTIVE policy. Re-check rather than assuming this still holds. Note the related trap already recorded below: two permissive policies OR'd together also defeat semi-join pull-up, which is why CONVENTIONS §8 prefers one policy with a single qual over two.

- **`scripts/assert-rls.ts:104` asserts a false premise, and its allowlist is empty at `:108` — and fixing it is where the anon-path list should permanently live.** The line claims "this app's entire data path is service_role". That is untrue, so the gate treats **any** anon reachability as a defect rather than failing on **unexpected** anon reachability, and today it models a world that does not exist. Until it is fixed, do not cite this script as evidence that a table has no anon path.

  **The fix, and why it is the right home for this list.** Seed `ANON_REACHABLE_ALLOWLIST` with the six tables below, each with its reader `file:line` refs as inline comments. That makes the inventory **executable and single-source**: the build fails the moment a seventh table — or a new reader of an existing one — appears on the anon path, which a prose document can never do. A markdown list of line numbers goes stale silently; an allowlist that gates CI cannot. (A working note with the full derivation, every receiver resolved, is at `scratchpad/ANON-PATH-TABLES.md` — it is disposable and should be deleted once this allowlist exists.)

  Verified 2026-07-30 by two independent derivations plus two adversarial passes: **37 anon call sites, 36 SELECT + one UPDATE, across exactly six tables.** All ten governing policies are correctly written.

  | Table | Anon readers (`file:line`) |
  |---|---|
  | `check_ins` | `app/api/client/check-in-context/route.ts:36` · `app/api/client/check-in-status/route.ts:38` · `services/client-portal-progress.ts:114` |
  | `clients` | `lib/auth-helpers.ts:135` · `:195` · `services/client-portal-service.ts:67` · `services/client-portal-progress.ts:135` · `app/api/content/download/[contentId]/route.ts:47` · `app/api/content/assignments/route.ts:69` · `app/api/content/assignments/[contentId]/[clientId]/route.ts:60` · `app/api/clients/[id]/activate/route.ts:121` · `:140` · **`:75` (the only anon WRITE in the app)** |
  | `coaches` | `lib/auth-helpers.ts:82` · `app/api/dashboard/attention-feed/route.ts:57` · plus 16 sites across `app/api/content/**` (`assignments`, `download`, `folders`, `items`, `library`, `metadata`, `upload`) |
  | `content_assignments` | `app/api/content/download/[contentId]/route.ts:60` |
  | `content_items` | `app/api/content/assignments/route.ts:55` · `[contentId]/route.ts:42` · `[contentId]/[clientId]/route.ts:46` |
  | `profiles` | `middleware.ts:58` · `:105` |

  **When this is fixed, also remove the `assert-rls.ts:104` warning clause from `docs/ARCHITECTURE.md` → Auth Model → Database clients.** It is a live warning about a live bug; it should not outlive the bug.

  Two properties the allowlist should encode alongside the names, because both are load-bearing and neither is obvious: **(1) four of these reads are universal gates** (now also labelled in the database itself — migration `137_comment_universal_gate_policies.sql` attaches `COMMENT ON POLICY` warnings so a cleanup pass sees them in `\d+` / Studio / `pg_dump` at the point of deletion) — `middleware.ts:105` (`profiles`), `lib/auth-helpers.ts:82` (`coaches`), `:135` and `:195` (`clients`) — dropping any of their policies is total product lockout, not a degraded feature. **(2) `app/api/content/download/[contentId]/route.ts` is a route where RLS *is* the authorization decision**: `hasAccess` is initialised `false` at `:31` and can only be set true by the anon results at `:35`, `:47` or `:60`. It fails closed, but a dropped policy there silently 403s legitimate users.
- **`nutrition_weekly_summaries` is writable by a coach over the anon key.** The policy `"Coaches can manage client weekly summaries"` (`live_public.sql:3376`) is `FOR ALL` with a `USING` clause and **no `WITH CHECK`**; Postgres reuses `USING` as the check, so the policy grants INSERT/UPDATE/DELETE as well as SELECT. Correctly tenant-scoped (`coaches.user_id = auth.uid()`), so this is not a cross-tenant hole — but a coach-writable table over PostgREST is almost certainly not what was intended, and this policy is also what masks the broken sibling `coaches_view_client_weekly_summaries`. Decide read-only vs read-write deliberately, then pin it.
- **`services/auth-profile-service.ts:56` escapes `%` and `_` but not `*` before an `.ilike()`.** PostgREST also treats `*` as a wildcard, so an email containing `*` turns the intended case-insensitive equality into a wildcard match against `client_invitations`. Impact in isolation is only a self-inflicted role downgrade (the user gets `profiles.role='client'` with no `clients` row, and every client API 401s) — it grants nothing. It matters because it bends **the same invitation-email lookup** that the invitation-accept hole abuses. **Review the two together in the auth workstream, not separately.** Note the comment at `:54-55` explicitly claims the escaping makes this equivalent to the trigger's `lower()=lower()`; that claim is false for `*`.
- **`createServerSupabaseClient()` is constructed without the `Database` generic**, so every read through it (and through its `createPortalClient` alias) is effectively untyped. `lib/supabase-server.ts:13` calls `createServerClient(url, key, {...})` where `services/supabase-admin.ts:18` calls `createClient<Database>(...)`. Surfaced concretely on 2026-07-30: moving three `getClientNutritionTargets` reads from the session client to `supabaseAdmin` immediately produced **six** `TS2322` null-vs-undefined errors that had been invisible for as long as the function existed (nullable numeric columns assigned to optional fields, plus `string` assigned to the `DietType` / `UnitPreference` unions). They were real — fixed at the boundary with `?? undefined` and explicit union casts — but nothing would have caught them at the session client. Every remaining SSR-client read carries the same blind spot; add the generic when the `createPortalClient` consolidation happens.
- **Services that take a resource id with no tenant scope parameter** — for the auth/onboarding workstream, **not started**. §8 calls this shape "a data leak waiting to happen", and four functions have it: `services/client-service.ts:181-202` `getClientById` (`.eq("id", clientId)` only — returns any coach's full client row: weight, body fat, BMR, email, notes, goals), `services/training-service.ts:200-209` `getTrainingPlanById`, `services/training-service.ts:212-228` `updateTrainingPlan` (a **write** with no tenant filter at all), and `services/training-log-service.ts:956-967` `getSessionLogDetail` (set-level workout data). Isolation is a post-hoc JS comparison — `client.coachId !== coachId` or `resource.clientId !== clientId` — repeated at ~40 separate call sites for `getClientById` alone. **Every call site enumerated does perform the comparison, so this is not a live vulnerability**; it is the unguarded primitive the whole coach surface rests on, and the type system cannot enforce the check. Fixing it means giving each a required scope parameter and filtering on it, which is a mechanical but wide change — hence its own workstream.
- **`getClientNutritionTargets` — redundant RLS gate removed (2026-07-30, done; recorded for provenance).** The function read `clients` / `nutrition_plans` / `nutrition_plan_daily_targets` through the session-scoped `createPortalClient` while fanning out to three `supabaseAdmin` readers (`getActiveTrainingPlan`, `getEventsForDateRange`, `getNutritionEventsForDateRange`; the first was dropped in the 2026-08-26 dead-code sweep, B4 — it fed a parameter the util could never read). Both callers (`app/api/client/nutrition-plan/route.ts:10`, `app/api/client/nutrition/route.ts:11`) already pass `auth.clientId` from `requireClientAuth`, so the RLS gate duplicated a check the route had made rather than adding one — but it was also the *only* control on the function, so a future "standardise onto `supabaseAdmin`" refactor would have silently converted it into a cross-tenant IDOR. Those three reads now use `supabaseAdmin`, matching the Shape B default and removing the trap by construction rather than documenting it. The three downstream readers were deliberately **not** changed: they already filter on the provided scope, and §8 is explicit that services trust their callers and do not re-verify. `createPortalClient` remains for `getClientForCurrentUser` (genuinely session-dependent) and `services/client-portal-progress.ts` (still a consolidation candidate — see the `perf-baseline.ts` followups).
- **Invitation-accept account binding — promoted out of "deferred", now the first item in the invite/signup workstream.** `app/api/invitations/accept/route.ts:20-40` → `services/invitation-service.ts:279-356`: the route is unauthenticated by design (`middleware.ts:22` skips `/api/invitations/`), takes **both** `token` and `userId` from the request body, and runs `supabaseAdmin.from("clients").update({ user_id: userId }).eq("id", invitation.client_id)` at `:334-337` without ever comparing the supplied `userId` to the caller's session or to `invitation.email` — while the **legacy `clientId` branch of the same route does exactly that check** at `route.ts:71-78`. Since `clients.user_id` is what `getAuthenticatedClientId` keys on (`lib/auth-helpers.ts:137`), anyone holding a live token can bind an arbitrary auth user to that client and gain full portal access to their health data. **Newly documented reconnaissance leg:** `app/api/invitations/[token]/route.ts` confirms a token is still valid *and returns the victim's name, email and coach name*, so an attacker can validate a stolen token before spending it. Mitigated only by `authRateLimit`, CSRF and token entropy.

---

## Production Readiness

Reviewed: 2026-03-18

### P1 - Infrastructure

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | **Per-coach AI spend quota — PRIMARY unbuilt cost control** | `app/api/training/assistant/route.ts`, `services/assistant/draft-agent-service.ts`, `services/ai-service.ts` | The draft assistant bills **per coach message**: a tool loop up to 30 iterations x 16000 max_tokens, model set by the `ASSISTANT_MODEL` env knob (default `claude-opus-4-8`). Owner measurement puts a working coach at **~$6/month on Haiku 4.5 vs ~$30 on Opus 4.8**. Because the tier is an env var, the quota — not the model choice — is what makes that number bounded rather than estimated. What exists: `assistantRateLimit` (20 req / 5 min, coach-keyed — burst control, not spend) and per-turn telemetry already logging iterations, token counts, `cacheEngaged` and `estimatedUsd`. What is missing: persisting that telemetry per coach + a daily/monthly USD ceiling enforced before the loop starts. Build on the existing `estimatedUsd` — no new measurement needed. Was deferred post-launch pending calibration data; **the telemetry IS the calibration data**. Raised from deferred by builder S6a/S7 (2026-07-21). The two OpenAI files it originally named are deleted. | Open — do first |
| 2 | Transaction wrapping for check-in submission | *(file deleted)* | Resolved 2026-08-06 by deletion: the token claim/create/update sequence lived in the magic-link submit route, removed with migration **142**. The authenticated portal path has no token to consume, so the failure mode is gone rather than fixed. | Resolved |
| 3 | Add structured logging | All API routes, services | All logging is `console.error`/`console.log` with unstructured messages. Adopt JSON-format structured logging with request IDs for better debugging and log aggregation in production. Currently relies on Sentry for error tracking but has no request tracing for non-error debugging. | Open |
| 4 | Monitor RLS query performance | `supabase/migrations/015_*.sql`, `supabase/migrations/044_*.sql`, `supabase/migrations/077_*.sql` | Nested subquery RLS policies on `training_exercises`, `nutrition_plan_daily_targets` and `nutrition_events` join through multiple tables (exercises -> sessions -> plans -> clients -> user_id). May degrade at scale. Set up query profiling to monitor these policies and consider denormalizing if latency increases. **Corrected 2026-07-21:** this entry previously also named `075_*.sql` / `training_events`. That was false — migration 075 is 27 lines (CREATE TABLE + 3 CREATE INDEX) and defined **no** RLS and **no** policies, so there was nothing to profile. `training_events` now has RLS with zero policies (deny-all, migration 122), which also has no measurable RLS cost. The genuinely expensive policies this entry never named are on `set_logs` (090), `exercise_logs` and `session_logs` (055). | Open |

### P1 - Observability & Error Handling

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Background task errors not reported to Sentry | `app/api/client/check-ins/route.ts` | Partially resolved 2026-08-06: the magic-link submit route this cited was deleted (migration **142**), taking `markReminderAsResponded()` with it. Still open for the authenticated portal route, where `triggerAISummaryGeneration()` remains fire-and-forget with only `console.error`. Add `captureApiError()` there. | Open |
| 2 | No retry logic on OpenAI calls | `services/ai-service.ts:60-76` | Transient failures (timeouts, rate limits) cause permanent failure for check-in summaries. Add exponential backoff retry (2-3 attempts) for transient errors. | Open |

---

### P2 - Cleanup

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Rate limiting uses IP only | `lib/rate-limit.ts:97-101` | `getClientIdentifier()` extracts IP from `x-forwarded-for` header. Does not incorporate authenticated user ID, so a single user behind a shared IP (office, VPN) shares quota with all other users on that IP, and an attacker can bypass limits by rotating IPs. Add authenticated user ID to the rate limit key when a session is available. | Open |
| 2 | In-memory rate limit fallback is per-process | `lib/rate-limit.ts:44-79` | When Redis is unavailable, rate limiting falls back to an in-memory `Map`. In multi-instance deployments (e.g., multiple Vercel serverless functions), each instance tracks limits independently, making the effective limit N times higher. Consider making Redis required in production. | Open |
| 3 | `check_in_tokens.client_id` column type mismatch | `supabase/migrations/002_create_check_in_tokens_table.sql` | Resolved 2026-08-06 by deletion, not by a type fix: migration **142** dropped `check_in_tokens` entirely along with the sunsetted magic-link check-in flow. (Migration 005 had already converted the column to UUID with a foreign key, so the entry was stale before that.) | Resolved |

---

## Production Readiness Audit - Medium Priority

Reviewed: 2026-03-18

### M - Performance & Data Integrity

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | N+1 query on habit stats | `hooks/use-client-habits.ts:42-81` | Fetches stats per-habit via individual API calls (`Promise.all` of N fetches). 20 habits = 20 HTTP requests. Fix: add batch endpoint `/api/clients/{id}/habits/stats-batch`. | Open |
| 2 | N+1 query on daily log count enrichment | `services/check-in-service.ts` | `enrichWithDailyLogCounts()` ran one DB query per check-in period (later collapsed to one bounded query). **Resolved by deletion** (2026-08-26 dead-code sweep, commit 3): the function and its only sender, the `includeDailyLogCounts` query flag on `GET /api/clients/[id]/check-ins`, had no caller and were removed. | Resolved |
| 3 | Missing indexes on frequently-queried foreign keys | `check_in_session_completions`, `check_in_exercise_highlights`, `check_in_external_activities`, `client_intake`, `nutrition_plan_daily_targets`, `nutrition_events`, `training_events` | FK columns used in WHERE clauses and JOINs lack composite indexes. Add `(client_id, created_at DESC)` composite on daily_logs and similar patterns on detail tables. The event tables are frequently queried by `(client_id, date)` — confirm that range is covered. | Open |
| 4 | Unbounded client list query | `app/api/clients/route.ts` | Lists all clients for coach with no LIMIT. Fine for <100 clients, problematic at scale. Add LIMIT + pagination. | Open |
| 5 | Daily logs need pagination for large date ranges | `app/api/client/daily-logs/route.ts`, `app/api/clients/[id]/daily-logs/route.ts` | Date range parameters have no pagination. Large historical queries could return thousands of rows. Add cursor-based or offset pagination for requests spanning large date ranges. | Open |
| 6 | Auth failures not logged for audit trail | `lib/auth-helpers.ts` | `getAuthenticatedCoachId()` and `getAuthenticatedClientId()` return null on auth failure without logging the attempt. Add structured logging with timestamp, route, and IP (not PII) for security auditing. | Open |
| 7 | Inconsistent error logging patterns | Various API routes | Some routes log raw `error` objects (`console.error("Error:", error)`) which could include stack traces and query details in Sentry. Standardize to `error instanceof Error ? error.message : "Unknown error"` pattern. | Open |

---

## Production Readiness Audit - Low Priority

Reviewed: 2026-03-18

### L - Nice to Have

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No realtime updates for coach dashboard | N/A | Coach dashboard relies on SWR polling (30s interval). New check-ins from clients don't appear in real time. Consider Supabase realtime subscriptions for check-in notifications. **Widened 2026-08-29 (C2):** `/api/check-ins/unreviewed` now also backs the Clients **nav badge** and the roster's **Ready-for-review** view, so that same 30s poll (plus `revalidateOnFocus`) is what bounds how quickly a submitted check-in appears in either — not just in the bell. | Open |
| 2 | Polling-based content notifications | `hooks/use-new-content-notifications.ts` | Uses localStorage + polling every 30s to detect new content. Not event-driven. Consider push notifications or realtime subscriptions. | Open |
| 3 | Some complex pages lack error boundaries | `components/check-in/check-in-form.tsx`, nutrition builder, training builder | High-complexity pages with multiple form steps are not wrapped in `<ErrorBoundary>`. A JS error in one section crashes the entire page. | Open |
| 4 | Check-in submission doesn't invalidate SWR caches | `app/api/client/check-ins/route.ts` (was the deleted magic-link route) | After client submits check-in, coach-side SWR caches for `/api/check-ins/unreviewed` stay stale until next polling interval (30s+). **Still open, and by construction:** the writer is the CLIENT's session, and no coach-side invalidator can reach it. `useInvalidateCheckInsQueue` (added 2026-08-29 in C0) closes the coach-side half only — a reply sent from the Check-ins tab refreshes the queue at once. Realtime or a push is the only fix for the client-side half; the surfaces waiting on it are now the bell, the toast listener, the nav badge and the roster's Ready-for-review view. | Open |
| 5 | CSP script-src uses unsafe-eval and unsafe-inline | `next.config.mjs` | Current Content-Security-Policy allows `unsafe-eval` and `unsafe-inline` for scripts due to Next.js requirements. Tighten for production using nonce-based CSP (requires Next.js config changes). | Open |

---

## Schema Readiness - Planned Work

Reviewed: 2026-03-22

### Client Metrics Log Extraction

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No body metrics history table | `clients` table | Create `client_metrics_log` table (client_id, date, source, weight, body_fat, bmr, tdee, measurements). Write to it from check-ins, intake sync, manual updates. Keep `current_*` columns on `clients` as denormalized cache. Currently biometrics are overwritten on the clients table with no history outside of check-in snapshots. | Open |

### Coach Exercise Library

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No canonical exercise reference | `training_exercises.name` | Create `coach_exercises` table (coach_id, name, category, muscle_groups, equipment, notes, video_url). Add nullable `coach_exercise_id` FK to `training_exercises`. Currently exercises are free-text with no canonical reference, blocking cross-client analytics, templates, and progressive overload tracking. | Open |

### Type Safety Gaps from Schema Split

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | `as never` casts on view/new table queries | `services/daily-logs-service.ts`, `services/attention-feed-service.ts`, `services/training-history-service.ts`, `services/weekly-nutrition-service.ts`, `app/api/client/session-completions/route.ts`, wellness/nutrition history routes and summary routes | 8 locations use `as never` casts bypassing type safety on `.from()`, `.update()`, or `.upsert()` calls for the `daily_logs_full` view and new child tables. These should be replaced with proper type definitions once the generated types stabilize. **RESOLVED 2026-05-21 (Session 3.1)** — the view + child tables are already in the generated types; removed every `as never` on `daily_logs_full`/`nutrition_logs`/`wellness_logs`/`training_logs` reads across these files plus `schedule-data-service.ts`. Unrelated `as never` casts (the stale `profiles`/`coaches`/`client_intake` types in #2, and the `create_*_atomic`/`transition_phase_atomic` RPCs) are out of scope and remain. **Update 2026-08-13:** the two `transition_phase_atomic` casts went with migration 133 (the function was dropped); `create_nutrition_plan_atomic`'s were removed by Session 5 Task 5.1. `create_training_plan_atomic` is the last one — promoted to its own entry at the top of this file, with the recipe. | Resolved |
| 2 | `types/database.ts` is stale — missing `profiles` and `coaches` | `types/database.ts` (3055 lines), `contexts/auth-context.tsx:92,114-116,125,149,174` | **Corrected 2026-07-24 (narrowly):** the profiles/coaches claim was stale — both tables ARE in the generated `Database` type (verified at HEAD), so no regeneration is needed for them, and the auth-context cast sites were deleted by the auth bootstrap refactor (Auth P2 #3 resolved). The rest of this entry (`as never` casts for post-split child tables per #1, other affected files) was **not** re-verified here and stays open as written. | Open (auth part resolved) |

### Check-in Training Completion Duplication

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Parallel entry for training completions | `check_in_session_completions`, `session_logs` | `check_in_session_completions` should pre-populate from `session_logs` for the check-in period instead of being a parallel entry system. Currently clients can enter conflicting completion data between the daily flow and the check-in form. **Addressed by Session 6.4 of the client portal redesign**: daily logs become the source of truth for the check-in, the form locks fields for logged days, unlogged-day edits route through the canonical per-card write endpoints, and the table is dropped in the same migration. Mark Resolved once 6.4 commits. | Scheduled |

### Post-Phase-7 Column Retirement

> **"Phase 7" here means CLIENT-PORTAL Phase 7 (`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`), NOT the Training Builder Phase 7 that shipped 2026-07-21.** They are different workstreams. The training-builder sweep does not unblock this entry, and `training_logs.trained` still has two live readers — do not drop it on the strength of the builder phase completing.

The client portal redesign (Phase 1 Session 1.7) rewires the attention feed's training signals to read `training_events.status` directly. The legacy `training_logs.trained` column becomes dead data once Phase 7 (coach-side metrics + progression) ships and no reader remains.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Retire `training_logs.trained` column | `training_logs` table; remaining readers: `utils/daily-logs-aggregation.ts:72` (the only logic read), plus the row mappers at `services/daily-logs-service.ts:118` and `lib/attention-feed-helpers.ts:100` | Once Phase 7 of the client portal redesign ships and `training_events.status` is the single source of truth for training completion, `training_logs.trained` has no consumers. Write a migration that (a) audits for any remaining readers via grep, (b) drops the column, (c) updates `types/database.ts`. Do NOT do this before Phase 7 completes — the attention feed rewire in Session 1.7 intentionally leaves the column in place for backward compat during the transition. **Update 2026-05-22:** the former primary reader `services/training-history-service.ts` was **deleted** when the coach training-history route unified on the event path (roadmaps are opt-in). **Update 2026-08-26:** the other reader, `fetchTrainingDataForPeriod` in `services/schedule-data-service.ts`, was deleted in the dead-code sweep (B5); the readers listed in the Files column remain, all on the `daily_logs`/spine side. | Open |

### Documentation Updates Needed

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | ~~CONVENTIONS.md daily_logs conventions outdated~~ | `docs/ARCHITECTURE.md` | Schema diagrams moved to `docs/ARCHITECTURE.md` with corrections applied (phase_id linkage, spine + child table architecture, training_data as UI restore cache). | Resolved |

---

## Pre-existing Test Failures

Reviewed: 2026-03-25. **Resolved as of 2026-04-23** — full `npx vitest run` passes (50 files, 683 tests). The entries below are preserved for historical context; all failures were addressed in earlier cleanup passes.

### Unimplemented Behavior (8 failures)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Tests expect sanitization logic that was never implemented | `ai-prompt-sanitizer.test.ts` | 8 tests expect `sanitizeForAIPrompt` to strip "Disregard", "Override", whitespace-prefixed injection patterns, and truncate at 500 chars. The implementation performs none of this. Tests were written for planned behavior. | Resolved |

### Stale Assertions After Refactors (12 failures)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Error message format mismatch | `client-service.test.ts` | 7 failures. Tests expect `"Failed to X: <db error>"` format but service throws `"Failed to X"` without appending the DB error. Tests also expect `getClientById` to return `null` for not-found but it throws, and expect `null` for empty string notes but service sends empty string. | Resolved |
| 2 | Color value assertions outdated | `check-in-utils.test.ts` | 4 failures. `getStatusColor` tests expect raw color names (`"yellow"`, `"blue"`, `"green"`, `"gray"`) but implementation returns semantic Tailwind classes (`"bg-warning/10 text-warning"`, etc.). Tests weren't updated after design token migration. | Resolved |
| 3 | Button variant class outdated | `button.test.tsx` | 1 failure. Expects `bg-white` class on secondary variant but component uses `bg-secondary`. Test wasn't updated after button styling change. | Resolved |
| 4 | Date-dependent test assertion | `attention-triggers.test.ts` | 1 failure. `evaluateTrainingMisses` test creates logs for today/yesterday and expects a trigger, but the function's week-window logic returns `null` depending on what day of the week the test runs. Test needs fixed date mocking. | Resolved |

### Incorrect Assumptions (3 failures)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Fallback mode assumption wrong | `rate-limit.test.ts` | 2 failures. Tests expect unlimited requests in fallback mode but in-memory rate limiter actually enforces limits. Tests assume fallback = no limit; implementation says fallback = still rate limited. | Resolved |
| 2 | Error exposure assumption wrong | `notifications/route.test.ts` | 1 failure. Expects raw DB error message in 500 response but route returns generic `"Failed to fetch notifications"`. Test expectation conflicts with the convention of not exposing internal errors to users. | Resolved |

---

## Training Plan Architecture

Reviewed: 2026-04-13

### ~~P2 - Rethink External Activities~~ (Resolved 2026-04-24)

Removed entirely in commits `37f6eaf..fadff55` (external-activities sprint, 7 commits). Features A (training-plan external activities: pre-generation activities, `session_type = 'external_activity'`, `activity_metadata`, `allowSameDayTraining` AI prompt flag, `check_in_external_activities` table) and B (daily external activities: `daily_external_activities` table + Daily Pulse write path) both gone. Coach calendar prescribes any session type as a regular training session now, as anticipated. Schema changes in migration `088_remove_external_activities.sql`. `IntensityLevel` relocated from `types/external-activity.ts` to `types/daily-pulse.ts` where it's still used by the in-JSONB unplanned-activity flow.

---

### Missing Mocks (2 suite failures)

Both suites now run cleanly; preserved for historical context.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Supabase client not mocked | `intake-review-service.test.ts` | Suite fails before any test runs. Imports `supabase-client.ts` which throws when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set. Needs `vi.mock("@/services/supabase-client")` at the top. | Resolved |
| 2 | Supabase admin not mocked (**history** — the roadmap route and its test were removed with migration 133; the mocking lesson stands) | `app/api/clients/[id]/roadmap/route.test.ts` (gone) | Suite fails before any test runs. Imports `supabase-admin.ts` which throws when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set. Needs `vi.mock("@/services/supabase-admin")` at the top. | Resolved |

---

## Auth Architecture Hygiene (Shape-B hardening)

Reviewed: 2026-04-23

CoachHub runs in a backend-mediated shape (browser → Next.js API → Supabase). The primary security control is route-level auth + ownership checks (the IDOR chain); service functions accept `clientId` explicitly and use `supabaseAdmin` internally; RLS is defense-in-depth. This is a valid and common pattern for apps with a dedicated backend, multiple audiences, cross-user reads, and server-only integrations (OpenAI, Stripe, email).

The consequence: the route layer **is** the security perimeter. Gaps in route-level auth are not caught by a second line of defense. The items below close that perimeter. Bundle into a pre-launch hardening session after the client portal redesign ships - do NOT mix into redesign work, it muddies the diffs.

CONVENTIONS §8 is scheduled for rewrite to describe this pattern accurately (currently describes an aspirational RLS-first model that was never actually built).

### H1 - Pre-launch

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Build `requireClientAuth()` helper | `lib/` (new), `app/api/client/**/route.ts` | `lib/require-coach-auth.ts` exists for coach routes; no client-side equivalent. Every client route rolls its own auth chain (rate limit → CSRF → `getAuthenticatedClientId` → 401 handling). Any route that forgets or reorders a step is a hole. A single shared helper returning `{ clientId }` or a typed error response eliminates drift. Duplicates "Authentication & Authorization P0 #3" — promoted here because it is Shape-B-critical. | Done |
| 2 | Audit every client-portal route for the §9 auth chain | `app/api/client/**/route.ts` | After H1 #1 ships, sweep every client route to confirm it uses the helper. No exceptions. A missing step in Shape B is the whole hole; there is no RLS safety net on admin-serviced reads. | Done |
| 3 | `invitation-service.ts` imports browser Supabase client | `services/invitation-service.ts:1` | Called from server-side routes but imports the browser client. In Shape A this would be caught by RLS because the browser client has no session server-side. In Shape B it means the route is authed, the service runs with no session, and nothing enforces scope. Direct bug. Duplicates "Authentication & Authorization P2 #7" — elevated priority due to Shape-B blast radius. (`getInvitationForClient` was later deleted outright in the 2026-08-25 dead-code sweep — no caller.) | Done |
| 4 | Consolidate duplicate Supabase server-client factories | `lib/auth-helpers.ts:5-28`, `lib/supabase-server.ts:8-29`, `services/client-portal-service.ts:14-36` | `createSupabaseServerClient()` (private, auth-helpers), `createServerSupabaseClient()` (exported, supabase-server) and `createPortalClient()` (exported, client-portal-service) were three byte-identical factories with confusingly similar names. In Shape B session-scoped is rarely used; three variants across the codebase is a foot-gun. Collapsed: canonical body lives in `lib/supabase-server.ts`; `auth-helpers.ts` imports it; `client-portal-service.ts` re-exports it as `createPortalClient` so existing service callers don't churn. Duplicates "Authentication & Authorization P2 #1" — elevated because Shape-B ambiguity. | Done |
| 5 | Session-log writes accept client-supplied `performedSessionId` / `trainingExerciseId` without plan-ownership check | `services/training-log-service.ts` (`writeSessionLog`) | The event-keyed writer took `performedSessionId` (written to `session_logs.training_session_id`) and each `exercises[].trainingExerciseId` (read for the prescription snapshot) straight from the request body with no ownership scope. Impact was a cross-tenant **read** primitive: a foreign session/exercise id resolved another client's prescription into the caller's own snapshot columns, then read back — plus a dangling foreign-FK write. Fixed: `performedSessionId` is validated via `training_sessions → training_plans.client_id` and the exercise read is scoped with a two-hop `!inner` embed; a non-owned id throws `TrainingLogOwnershipError` → 404. | Done |
| 6 | Client portal fetches a coach-facing endpoint (`/api/clients/[id]/activation-readiness`) | client-side caller TBD (grep `activation-readiness` under `components/`, `hooks/`, `app/client/`) | Network logs on client login show `GET /api/clients/[id]/activation-readiness 401`. That route is under `/api/clients/` (plural — coach-facing per CONVENTIONS §6). The 401 is the route defending correctly; the bug is that a client-portal component or SWR hook is calling a coach endpoint at all, violating the audience-split rule. Risk: low today (coach session check rejects the request), but if the route ever relaxes its auth shape, the client portal would start receiving data it shouldn't. The redesign (`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`) rebuilds client screens from scratch and may retire the offending caller incidentally, but we should not rely on that — grep, find, remove. Surfaced during the H1 #2 sweep smoke test. | Open |

### H2 - Post-launch operational hygiene

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Structured auth-failure logging | `lib/auth-helpers.ts` | `getAuthenticatedCoachId` and `getAuthenticatedClientId` return null on auth failure with no log. In Shape B these are security-relevant events; without an audit trail a probe campaign is invisible. Log timestamp, route, IP (not PII), reason (missing / invalid / expired). Duplicates "Production Readiness Medium #6". **Shipped for the client path** — `requireClientAuth` threads `request` into the helpers, so 29 client-portal routes now emit `auth_failure` warns with route + hashed IP (SHA-256 truncated). Coach path logs reason + timestamp but logs `route: "unknown"` and `ipHash: "unknown"` because the 72 coach-route call sites don't thread `request`. Follow-up: add an optional `request` arg pass-through at the coach call sites (low-priority mechanical change). | Partially done |
| 2 | Codify "services accept `clientId` explicitly" | `CONVENTIONS.md §8`, all `services/*.ts` | Most services follow this already but it is convention not rule. Make it a documented requirement: no service function reads client-owned data without a `clientId` parameter. Audit call sites to prove compliance. Addressed as part of the §8 rewrite. **Codified: §8 line 242 explicitly names the rule as written. Audited: 14 real violations + 4 borderline cases found, restructured fix tracked as H2 #3.** | Done (audited) |
| 3 | Fix §8 service-scoping violations surfaced by the H2 #2 audit | `services/check-in-service.ts`, `services/training-session-service.ts`, `services/check-in-details-service.ts` | The H2 #2 audit found service functions that mutate or read client-scoped tables by primary key alone without accepting or filtering on `clientId`. In practice, the route layer catches IDOR today (coach routes use `requireCoachOwnsCheckIn` / `requireCoachOwnsClient`), but §8 treats service-layer scope as non-optional defense-in-depth. Violations: **`check-in-service.ts`** — `getCheckInById` (borderline, reads by id), `updateCheckInAISummary` (L255), `updateCheckInResponse` (L288), `markResponseAsSent` (L307). **`training-session-service.ts`** — `addSession` (L86), `replaceSessionExercises` (L138), `getSessionWithExercises` (L191), `updateSessionCalories` (L312), `cloneSessionForEvent` (L372). **`check-in-details-service.ts`** — `getCheckInSessionCompletions` (L21), `getCheckInExerciseHighlights` (L42), `getCheckInExternalActivities` (L60) (all borderline — query by `check_in_id` after caller has authorized the check-in). Fix pattern: add `clientId` parameter; training functions resolve scope via `training_plans.client_id` join; pre-flight ownership query + `.eq("client_id", clientId)` on the mutation. Route callers then pass the scope through. Not trivial — ~14 function signatures and their callers change. Keep routes' existing ownership guards in place; this is defense-in-depth, not a replacement. | Open |
| 4 | Route handlers calling `supabaseAdmin` directly instead of going through services | `app/api/**/route.ts` (36 files) | Audit on 2026-05-01: 36 of 131 route files contain `await supabaseAdmin.from(...)` inside the handler instead of delegating to a service function. Worst offenders by raw count: `clients/[id]/nutrition/route.ts` (5), `clients/[id]/nutrition/skew/route.ts` (5), `clients/[id]/metrics/route.ts` (4), `client/phase-completion/route.ts` (4), `clients/[id]/history/wellness/route.ts` (3), `client/session-completions/route.ts` (3, will be retired by event-keyed log path in Sessions 1.2/1.3). Most violations are 1-2 ad-hoc queries the developer didn't bother factoring (e.g., a 6-line next-future-plan lookup inline in `clients/[id]/training/route.ts` — additive placement has no `planned` status, so it selects the next plan whose `effective_from` is after today). A few are deliberate exceptions and self-document with a comment (e.g., `clients/[id]/history/nutrition/summary/route.ts:22` — `// Uses supabaseAdmin: coach querying client data (RLS exception 2)`). **Risk**: low security blast radius — every offending route still runs the full §9 auth chain before the direct query, so this is a layering smell, not a hole. The cost is maintenance friction: changing how a table is read/written requires grepping the route layer too, not just the service layer. **Fix pattern (lazy migration, not a sweep)**: next time a route in this list is edited for any reason, factor its direct queries into a service function; routes that have a legitimate reason to keep the direct call (e.g., aggregate count queries that don't fit any existing service's responsibility) get a one-line `// Uses supabaseAdmin: <reason>` comment matching the existing pattern. Don't do a 36-file refactor PR — diffs become unreviewable and the cleanup risks regressions in routes nobody is actively touching. Track convergence by re-running `grep -rln "await supabaseAdmin" app/api/ \| grep -v ".test.ts" \| wc -l` quarterly; expect the number to drift toward ~5 (legitimate exceptions) over a year of normal feature work. | Open |
| 5 | Circular import: `client-portal-service` ↔ `client-portal-training` | `services/client-portal-service.ts`, `services/client-portal-training.ts` | Resolved 2026-05-01. `client-portal-service.ts` imported `getClientTrainingPlan` from `./client-portal-training`, while `client-portal-training.ts` imported the re-exported `createPortalClient` from `./client-portal-service`. JS handles circular imports by returning a partial module at load time, but this can break in subtle ways during initialization. Fix: changed `client-portal-training.ts` to import `createServerSupabaseClient` directly from `@/lib/supabase-server` (aliased to `createPortalClient` so call sites are unchanged). Cycle gone; no behavior change. Surfaced during the 2026-05-01 structural audit. | Done |
| 6 | `getClientNutritionTargets` couples a read to a write + uses session-scoped Supabase | `services/client-portal-service.ts:59-137`, callers including `app/api/client/nutrition/route.ts`, `app/api/client/nutrition-plan/route.ts` (Session 2.9) | Two related smells in one function. **Smell 1 — ✅ RESOLVED (events-SOT S3):** `promoteNutritionPlanIfReady` was **deleted** (no planned→active promotion exists; nutrition moved to one durable plan in events-SOT S3 and then to date-ranged VERSIONS in migration 144 — under both, "current" is never a status flip), so `getClientNutritionTargets` no longer couples a write into a `get*`. The read-vs-write coupling is gone. **Smell 2**: the function uses `createPortalClient` (session-scoped, RLS-bound) where CONVENTIONS §8 calls `supabaseAdmin` the default for services. Functionally identical for the access pattern in normal flow (both apply `.eq("client_id", clientId)` against a `requireClientAuth`-verified id; RLS is belt-and-suspenders), but legacy by convention. **Fix pattern (Smell 2 only — Smell 1 no longer applies)**: switch `getClientNutritionTargets` from `createPortalClient` (session-scoped) to `supabaseAdmin` (the §8 service default). The old "split into `WithPromote` / `ReadOnly` orchestrators" plan is moot now that the promotion write is gone. No security delta under Shape B (both filter `.eq("client_id", clientId)` against a `requireClientAuth`-verified id); tackle when the service is next touched. | Partially resolved (Smell 1 gone; Smell 2 open) |

### H3 - Philosophical cleanup (defer)

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | Simplify nested-subquery RLS policies | `supabase/migrations/015_*.sql`, `044_*.sql`, `077_*.sql` | The 4-level subquery chains for training_exercises / nutrition_events / etc. exist because RLS was written assuming direct-to-Supabase access that never materialized. Under Shape B these policies don't run (service_role bypasses them) and carry only perf cost. **⚠️ Rewritten 2026-07-21 — the previous version of this entry was actively dangerous and must not be restored.** It (a) named `075_*.sql` / `training_events` as carrying nested-subquery policies when that table had **no RLS at all** — the exact property whose absence was the top finding of the 2026-07-21 database audit; (b) prescribed *"Replace with simple `authenticated`-role policies"*, which would convert these tables into a platform-wide cross-tenant read, precisely the bug migration 105 was written to fix and that 091/101 reintroduced; and (c) asserted *"Not a security issue — the app layer is the control"*, which is false at the PostgREST layer, as the threat-model correction at the top of "Known RLS Gaps" already states. **If simplifying, collapse the client-side and coach-side policies into ONE correctly-scoped policy per table** (one qual, no top-level OR, so the sublink can pull up to a semi-join) — never an `authenticated`-allow policy. Defer; the migration effort outweighs the gain pre-launch. Duplicates "Production Readiness P1 #4". | Open |

---

## Design System & Color Tokens

Reviewed: 2026-05-12

### P2 - Code Quality

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 1 | No color tokens in the Tailwind theme; 501 hardcoded hex values across 95 files | `app/globals.css` (`@theme inline`), 95 component/page files | The theme defines zero custom colors. The brand teal (`#0d9488`) is actually Tailwind's built-in `teal-600`, but the codebase universally uses arbitrary-value syntax (`text-[#0d9488]`, `bg-[rgba(13,148,136,0.15)]`) instead of utility classes. Secondary colors like `#93b0b4` (muted inactive) have no Tailwind equivalent and genuinely need config entries. `lib/design-tokens.ts` is referenced in CONVENTIONS.md but was never created. If the brand color changes, it requires find-and-replace across 95 files. | Open |

**Suggested fix:**

1. Add custom color tokens to `app/globals.css` under `@theme inline` (Tailwind v4 is CSS-first here — `postcss.config.mjs` loads only `@tailwindcss/postcss` and `globals.css` has no `@config`, so there is no JS config; the inert `tailwind.config.ts` was deleted in the 2026-08-25 dead-code sweep): `--color-brand` (teal-600 / `#0d9488`), `--color-brand-muted` (`#93b0b4`), and the common rgba variants as opacity modifiers.
2. Bulk-replace `text-[#0d9488]` with `text-brand`, `bg-[#0d9488]` with `bg-brand`, etc. across all 95 files. Mechanical change, safe to do in a single sweep PR.
3. Either create `lib/design-tokens.ts` as referenced in CONVENTIONS, or remove the CONVENTIONS reference if the `@theme` block is the canonical token source. Pick one, not both.

| # | Issue | File(s) | Details | Status |
|---|-------|---------|---------|--------|
| 2 | The check-in review's five section cards still carry a border and a framer stagger the new card does not | `components/check-in/wellness-section.tsx`, `nutrition-section.tsx`, `training-section.tsx`, `habits-section.tsx`, `client-notes-section.tsx` | C4 (2026-08-30) made the AI review rail ONE borderless white card, per the SOT's "spacing does separation, not borders" (`docs/newdesignsystem.md:36`), and D7.3 settled that the five siblings in the left column are owed the same rather than being converted in the same commit — converting one of five would have made the column look broken instead of consistent. Until then the Current pane is deliberately asymmetric: a bordered, animated left column beside a borderless, still right rail. Each sibling also renders its own `text-sm` body against the rail's 13px. | Open |

**Suggested fix:** drop `border border-[rgba(13,148,136,0.08)]` and the `motion.div` wrapper from all five in one sweep, and move their bodies onto `ReviewProse`'s 13px tier where they render prose. Mechanical; no logic. Do all five together.

---

## Training Builder & Content Library Bloat

Re-measured 2026-07-21.

### P1 - File Size Violations (re-measured at HEAD)

| # | File | Lines | Limit | Over By | Status |
|---|------|-------|-------|---------|--------|
| 1 | `services/training-log-service.ts` | 934 | 300 | 634 (211%) | Open — worst offender |
| 2 | `services/coach-saved-plan-service.ts` | 785 | 300 | 485 (162%) | Open |
| 3 | `services/library-placement-service.ts` | 585 | 300 | 285 (95%) | Open — but cohesive (one transactional placement flow) |
| 4 | `services/exercise-catalog-service.ts` | 571 | 300 | 271 (90%) | Open |
| 5 | `components/clients/training/program-builder/program-builder.tsx` | 559 | 250 | 309 (124%) | Open — but cohesive (pure orchestrator, one DndContext; its state already lives in `ProgramDraftProvider`) |
| 6 | `__tests__/helpers/mock-data-builders.ts` | 182 | 250 | -68 (-27%) | Reduced — the 2026-08-25 dead-code sweep deleted nine importer-less builders (was 633) |

**Suggested split (2):** `coach-saved-plan-service.ts` holds the whole-tree write surface (`overwriteSavedPlan`, `promoteDraftToSaved`, `duplicateSavedPlan`, `saveSessionFromCalendar`) alongside the list/paged/summary reads. Lift the write path into `coach-saved-plan-write-service.ts`, leaving reads + status transitions behind.

**Long but cohesive — deliberately left alone** (splitting would prop-drill one flow across files, which §4 itself warns against): `training-calendar-view.tsx` 514, `training-event-calendar-service.ts` 190, `session-detail-drawer.tsx` 575, `content-upload-dialog.tsx` 532, `app/dashboard/content/page.tsx` 497.

---

## Timezone correctness — deferred tail (after sessions 7.81–7.85)

Logged: 2026-06-10; updated 2026-06-12 (Session 7.85). Sessions 7.81–7.84 (`docs/CLIENT-PORTAL-EXECUTION-PLAN.md`) fix device-synced capture (client + coach), plan placement, promotion, check-in gate, streaks, client home, and coach-side windows to the locked model: *"today" = the device timezone of whoever the date belongs to.* Session 7.85 anchored the write-path stragglers: phase-transition stamps (`p_today`, migration 111), the attention-dismissal date (coach-local; migration 112 dropped the table's UTC default), the three bare delete-future calls, and **four** swallowed `{ data }`-only destructures hardened to loud `{ data, error }` handling (`getDayEditState`, `assertCanEditTrainingDay`, `enrichWithDailyLogCounts`, and `getCoachTodayString` itself). These items are intentionally left for later.

### P2 - Deferred
- **Reminder email cron is unwired.** `services/reminder-service.ts` (`sendAutomatedReminders`) has no invoker (no cron). Session 7.84 fixed the shared tracking fns it calls (`getDaysUntilOrPastDue` etc. now resolve the CLIENT's local day from `client.timezone`), so the day math is correct — but the cron itself is still unwired, and `lastReminderSentAt` throttling plus the send time-of-day remain untimezoned. Wire + verify before enabling.
- **Sites deliberately left on server UTC** (dead fallbacks or non-day-decision uses, all commented in-file where relevant): the planId-only event-cleanup fallbacks (`deleteFutureNutritionEventsForPlan`, `cancelFutureEventsForPlan`; `deleteFutureEventsForPlan` had no caller at all and was deleted in the 2026-08-25 dead-code sweep) — as of Session 7.85 every live caller passes an explicit anchored date (the three bare callers in phase-transition ×2 and library-placement ×1 were the gap; the audit falsified the previous version of this claim), so the optional `fromDate`/`effectiveFrom` params are dead defensive code and could now be made required; `getWeeklyHabitsData`'s `todayAnchor` default (its only caller passes coach-local); coarse abuse bounds (e.g. the habits/weekly "max 7 days in future" range check — ±tz slack is harmless); audit/`created_at`/`updated_at` timestamps throughout (instants, not day decisions). `validateDateParameter` is now format-only — day bounds belong to write-side `canEditDay` (7.83).
- **Non-day-decision `{ data }`-only swallows left after 7.85** (out of that session's tz scope, same silent-failure smell): the child-row "logged" check in `services/daily-log-permissions-service.ts` (~L90; a swallowed error reads as never-logged). Harden opportunistically. *(The `phase-transition-service.ts` captures referenced here were deleted with the roadmaps/phases removal, 2026-07-25; the former `library-placement-service.ts` active/planned-plan lookups were removed by the additive placement rewrite, events-SOT S2.)*

### P3 - Guardrail (defer until users exist)
- **No lint rule prevents a new server-side UTC `getTodayDateString()`.** After 7.81–7.84, a fresh `getTodayDateString()` / bare `CURRENT_DATE` in `services/**` or `app/api/**` silently reintroduces the bug. A custom ESLint `no-restricted-syntax` rule banning it server-side (allowing browser/`'use client'` code + `lib/date-helpers.ts`) would prevent regressions. Deferred per "defer tooling until users exist."

---

## Metrics page — coach-logged entries (post-redesign tail)

Logged: 2026-07-25 (Metrics page redesign, migration 132).

### P2 - Deferred
- **No DELETE/edit path for `client_metric_entries`.** A mistaken entry can only be corrected by re-logging the same metric + date (upsert replaces); it cannot be removed. A DELETE handler is small, but the weight case is not: deleting the latest weight entry should re-derive `clients.current_weight` from the next-latest `body_metrics` event, which the current cache-update path (`recordBodyMetrics`'s `updateClientCache`) has no machinery for. Build the re-derivation with the DELETE, not before.
- **~~`hooks/use-client-metrics.ts` dead save/dialog members~~ — RESOLVED 2026-08-12 (Session 4B, Task 4b.3).** The whole hook was deleted with the `calculate-bmr` route: the pair recomputes on every input change, so the manual button had no job, and `page.tsx` destructured only those two members. That also removed the broken `saveOption: "update-only"` value by deleting the unreachable code carrying it rather than "fixing" a bug nothing could reach.


## Client energy (BMR/TDEE) — residuals after Session 4B

### P2 - Accepted, documented
- **Old nutrition plan versions keep their garbage-in TDEE snapshots.** A version records
  what it was built from, and before 4B that could be a TDEE derived from the PLAN's
  activity level rather than the client's. Those rows are honest history and are
  deliberately not rewritten — but they are surfaced: the Journey blocks' nutrition
  column reads the covering version's snapshot, and the nutrition drawer now shows a
  drift line when a version's TDEE differs from the live profile. A regenerate is the
  gesture that adopts the current numbers.
- **The Mifflin-St Jeor age default (`DEFAULT_BMR_AGE_YEARS`, 30) still applies wherever
  the nudge cannot reach.** The client settings dialog surfaces "add a birth date for a
  more accurate BMR" only when age actually changes the answer (the Katch-McArdle path
  has no age term). A client created without a birth date and never opened in that
  dialog is silently costed at 30. `clients.date_of_birth IS NULL` is the durable
  signal if another surface wants to warn.
- **Existing seeded clients carry incoherent pairs.** 200 of 208 active DEV clients had a
  TDEE unrelated to their own BMR × activity, because `scripts/seed/generate.ts` used a
  random 1.35–1.75 multiplier. The generator is fixed, so this only affects rows seeded
  before 2026-08-12; they are benchmark fixtures, not smoke fixtures. A bulk repair is
  one pass of `recalculateClientEnergy` if it ever matters.

### P1 - Fix the key before the tiers
- **The rate limiter does not namespace its Redis key by tier.** `lib/rate-limit.ts`
  hardcodes `prefix: "ratelimit:api"` and keys on the bare IP, so every tier through the
  generic `rateLimit()` shares one counter per IP and the effective ceiling depends on
  which limiter ran last. The in-memory fallback namespaces by config, so the two paths
  disagree; `assistantRateLimit` sets its own prefix and is isolated. **Visible symptom:**
  21 `/api/clients/**` route files sit on `apiRateLimit` where CONVENTIONS §9 mandates
  `coachApiRateLimit`. Retiering them without fixing the key perturbs unrelated routes for
  the same IP, so the tier sweep is blocked on the key fix, not the other way round.
  Logged: 2026-08-12 (Session 4B).
