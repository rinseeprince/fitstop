# Placed-Plan Editing Overhaul — Execution Plan (2 jobs)

Planned 2026-07-22 after full codebase exploration (three parallel explorations + three design passes, reconciled). This doc is the approved spec for two independent Claude Code sessions. **Job 1 must fully ship before Job 2 starts** — Job 2 wires seams Job 1 creates.

**Paste-able prompts are at the bottom of this file.**

---

## Why

The training builder overhaul shipped (all 7 phases), but once a program is placed on a client's calendar, editing regresses to a legacy tray:

- The calendar's slide-out drawer edits only compact sets/reps — it never reads `set_specs`, and its shared-session bulk save **actively wipes** `set_specs`/`video_url` (`buildExercisePayload` omits them → `projectExerciseCompact` writes nulls). No renames, no per-set types, no drop sets, no video, no tempo/%1RM.
- There is no way to amend a placed plan mid-flight ("client isn't coping 5 weeks in — reduce load for everything remaining").
- The AI assistant works only on library drafts and pre-placement client-drafts.
- The Plans-subtab layout is legacy: 600px inner-scroll month list, tiny cells, raw-Tailwind status colors, native `confirm()`/`prompt()`, an unconfirmed "Clear week" delete.

**Job 1** delivers builder-grade single-session editing from the calendar + the full Teal-Summit redesign of the Training→Plans subtab.
**Job 2** delivers plan amendments (edit all remaining sessions in the shared builder grid, past locked) + the AI assistant on placed plans.

## Owner decisions (final — do not re-litigate)

1. Amendment shows the **full program, elapsed slots locked** read-only; week numbers stable.
2. **Full builder power** in amendments — structure edits allowed; future events re-dated by re-walking the future window; past untouched.
3. Entry points: **both** — "Edit plan" on the calendar hero + "Edit whole plan" link in the session tray.
4. Redesign scope: **whole Plans subtab**, staying a real-date Mon–Sun month calendar (not the builder's positional Day 1–7).
5. Placed identity (program/session name + focus) is **editable** on both new surfaces; renames propagate to **future scheduled events only** (past keeps snapshots — that is correct history).
6. Future `is_modified` scheduled events are **deleted** by an amendment, behind an explicit warning listing them (consistent with migration 114's placement delete).
7. **No new RPC / no migrations** — amendment uses the app-side H3 snapshot/compensate idiom placement already uses.
8. `effective_until` stays NULL after amendment (plan resolution unchanged). Extending an ended plan is blocked v1 ("apply a new program" is the gesture). Duplicating fully-elapsed weeks is blocked v1 (boundary week allowed).
9. Event move/delete/duplicate stay calendar-level — NOT in the tray.
10. Surplus on placed surfaces is **absolute** (placed rows carry the resolved value; there is no stored plan default to inherit).

## Verified architecture facts (trust these; re-verify only if the code has moved)

- **1:1 invariant**: a pristine placement creates 1 `training_sessions` row ↔ 1 `training_events` row ↔ 1 date (one-pass date-walk; rest slots are real rows that advance the walk and emit no event). Editing a future session row cannot corrupt past history; logged history is additionally frozen in `session_logs.prescribed_session_snapshot`.
- **Diverged plans are real**: `duplicateWeek` and `cloneSessionForEvent` copies keep the SOURCE `(week_index, order_index)` verbatim → colliding coords. Every canonical read must sort `(week_index, order_index, created_at, id)` and tolerate non-7-slot groupings (flat-regroup fallback, same as `savedPlanToDraft`'s flat path).
- The date-walk is pure arithmetic: `slotPosition = daysBetween(effective_from, date)` — resuming mid-program is a `startPosition` offset into the sorted slot array.
- `training_sessions` has **no `session_type` column** — synthesize `"training"` when seeding drafts.
- `updateSession` (`services/training-session-service.ts`) **never updates** `training_events.session_name`/`session_focus` — an existing rename-staleness gap the new session PUT closes.
- `updateExercise` **service** already supports `setSpecs`/`videoUrl`; the wipe landmine is schema-only (`updateExerciseSchema = exerciseSchema.partial()` strips them via zod).
- The builder grid + dnd + ops address ONLY client-minted uids — zero DB-id coupling. The builder mounts anywhere a `ProgramDraft` exists.
- The tray template: `components/programs/use-standalone-session-editor.ts` — bare `useProgramBuilderState` + `makeStandaloneDraft(session)` (one-week wrapper, session in slot 0) + read back `weeks[0].days[0].session` + explicit Save.
- Coach event mutations all guard `status='scheduled'` + `date >= getClientTodayString(clientId)`; completed events (carrying `session_log_id`) are untouchable.
- `create_training_plan_atomic` (mig 114, 23-arg, service_role-only) deletes only scheduled events in `[GREATEST(effective_from, p_today), p_window_end]`; event generation is app-side with `snapshotWindowEvents`/`compensatePlacement` recoverability.

**Landmines every new write path must honor:**
- `training_events.calorie_surplus_percentage` populated on EVERY event write (nutrition cascade reads it; a dropped write silently reverts the client to rest-day calories).
- Every training mutation route calls `cascadeNutritionAfterTrainingChange(clientId, anchor, tag)` with the correct per-op anchor.
- Every client-side mutation success calls `useInvalidateNutritionCalendar(clientId)`.
- All "today" floors via `getClientTodayString(clientId)` (`services/today-service.ts`) — never server UTC.
- Exercise clone/insert paths **splat** `set_specs`/`video_url` verbatim (never re-derive on a copy); fresh authoring goes through `projectExerciseCompact`.

---

# JOB 1 — Builder-grade session tray + Plans-subtab redesign

Three workstreams, committed in order, each gated green (`npx tsc --noEmit` + `npx eslint .` + `npx vitest run`).

## 1A. Backend: session full-edit + schema fix

1. **Widen `updateExerciseSchema`** (`lib/validations/training.ts:54`):
   `exerciseSchema.partial().extend({ setSpecs: setSpecsArraySchema.nullish(), videoUrl: videoUrlSchema })`. The service already handles both — this one line fixes the compact/spec divergence landmine wherever the PATCH is used.
2. **New `services/training-session-replace-service.ts`** (new file — `training-session-service.ts` is at 365 lines):
   `replaceSessionFull({sessionId, planId, clientId, coachId, fromDate, input})` where input = `{name, focus, estimatedDurationMinutes, calorieSurplusPercentage, notes, exercises: ExerciseInput[]}`. Steps: ownership via the session→plan→client inner-join (copy `bulkReplaceExercises`' idiom), reject `is_rest` rows; read current row to compute `surplusChanged`/`identityChanged`; `bulkReplaceExercises(sessionId, exercises, coachId, clientId)` (existing — insert-new-then-soft-delete-old, full setSpecs); single UPDATE of session meta; if `identityChanged` → `UPDATE training_events SET session_name, session_focus, updated_at WHERE training_session_id = sessionId AND status = 'scheduled' AND date >= fromDate` (**future scheduled only**); if `surplusChanged` → `updateSurplusForFutureEvents(sessionId, surplus, fromDate)` (existing). Returns `{session, surplusChanged, identityChanged, futureEventsUpdated}`. Each step idempotent — a retried Save repairs any partial; no compensator needed at this blast radius.
3. **Route** `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts`:
   - Add `PUT` beside GET/PATCH/DELETE, chain identical to the existing PATCH (coachApiRateLimit → CSRF → coach auth → client ownership → session-belongs-to-plan → zod). New `replaceSessionSchema` in `lib/validations/training.ts`: `{name: 1..100, focus: ≤200 nullish, estimatedDurationMinutes: int 0..480 nullish (authoring bounds, matching what placement already writes — NOT legacy sessionSchema's 10..180), calorieSurplusPercentage: 0..100 nullish, notes: ≤1000 nullish, exercises: z.array(bulkExerciseInputSchema).max(50)}`. Resolve `today = getClientTodayString(clientId)` once; call the service; cascade **only when `surplusChanged`** (anchor = today).
   - **Extend GET** additively: return the session's linked `events: [{id, date, status, isModified}]` (one query on `training_session_id`) plus `clientToday`. The tray derives its shared-occurrence count from these.
4. The clone route (`POST .../sessions/[sessionId]/clone`) is already builder-grade (accepts full `bulkExerciseInputSchema`) — unchanged; it stays the "just this day" path.
5. **Tests**: `training-session-replace-service.test.ts` (rename → future-scheduled-only snapshot update; surplus flag + `updateSurplusForFutureEvents(fromDate)` called; setSpecs/videoUrl verbatim survival; rest/foreign-session rejection; no-change input → no event writes). Route test per the existing route-test idiom (validation, cascade fired only on surplusChanged, GET returns `events[]`). Schema regression: `updateExerciseSchema` passes setSpecs/videoUrl through.

## 1B. Frontend: placed-session tray (replaces the legacy drawer)

1. **New `components/clients/training/program-builder/placed-serialize.ts`** (Job 2 extends this file — create it now with the tray pieces):
   - `trainingSessionToDraft(s: TrainingSession): {draft: SessionDraft, exerciseIdByUid: Map<string,string>}` — undefined→null coercions, `[]` setSpecs → null, fresh uids, `sessionType: "training"`.
   - `sessionDraftToPlacedPayload(s: SessionDraft)` → the `replaceSessionSchema` body. Reuse `exerciseDraftToInput` — **export it (and `draftToSessionInputs`) from `program-builder-serialize.ts`** (Job 2 needs the latter).
2. **New `components/clients/training/calendar/use-placed-session-editor.ts`** (~230 lines): clone `use-standalone-session-editor.ts` structurally — **export `makeStandaloneDraft`** from that file (one-line change) rather than duplicating it. State input `{clientId, planId, sessionId, eventId, date} | null`. SWR read of the extended session GET (key nulled when closed, `swrFetcher`, `revalidateOnFocus: false`). Seed-once per identity `${sessionId}:${eventId}`. Mutators passed 1:1 from the bare `useProgramBuilderState` + `useSetSpecMutations(builder.updateExercise)`. `handleSave(scope: "all" | "day")`: serialize slot 0; `"all"` → new PUT; `"day"` → existing clone route with exercise overrides (then re-select the returned new sessionId). Success: toast → `await mutateCalendar()` → `void invalidateNutritionCalendar(clientId)` → session-key mutate → `fetchPlan()` → close. Dirty cancel → discard-confirm dialog; block dismissal while saving.
3. **New `components/clients/training/calendar/placed-session-editor.tsx`** (~200 lines): 780px right Sheet per `docs/newdesignsystem.md` Overlays recipe (`sm:w-[780px] sm:max-w-full`, white, `p-0`, bordered header/footer — the builder look, NOT the legacy dark-header drawer). Body = `SessionEditorBody` with `mode="edit"`, `identityEditable={true}`, `defaultSurplusPercentage={null}`, `surplusHelpText="Leave blank for no surplus"` (absolute semantics — decision 10). Footer Cancel/Save. Scope dialog ("Just this day" / "All occurrences") shown when future scheduled event count > 1 (from GET `events[]` + `clientToday`), else direct `"all"` save. Header: Dumbbell thumb, session name, date meta; overflow menu with **Save to library** (port the `from-calendar` flow; replace its `prompt()` with a styled Dialog name field) and **Edit whole plan** (calls optional `onEditPlan` prop — **render only when the prop is provided; Job 2 wires it**).
4. **`training-calendar-view.tsx`**: swap `SessionDetailDrawer` → `PlacedSessionEditor`; delete the lazy session-fetch effect + snapshot state + `sharedEventCount` memo (~−60 lines); accept + thread optional `onEditPlan`.
5. **Delete** `calendar/session-detail-drawer.tsx`, `sessions/training-exercise-row.tsx`, `sessions/add-exercise-dialog.tsx`, and the then-empty `components/clients/training/sessions/` dir. Delete-then-document: update CONVENTIONS.md §6 ("Where training UI lives" — `sessions/` folder note) and §8's `is_warmup` sentence ("still written by the calendar drawer's add-exercise dialog" — now stale; `isWarmup` still round-trips through the draft, no new UI), plus ARCHITECTURE.md drawer references. Grep for imports of the deleted files at execution time — do not trust this list.
6. **New `useInvalidateTrainingCalendar`** co-located in `hooks/use-calendar-events.ts`, mirroring `useInvalidateNutritionCalendar`'s key-prefix predicate pattern exactly (`/api/clients/${clientId}/training/events?`). The only sanctioned external refresh of the events cache (Job 2's overlay uses it).
7. **Tests**: tray component test mirroring `standalone-session-editor`'s; keep every existing calendar test green.

## 1C. Frontend: Plans-subtab redesign (Teal-Summit)

Read `docs/newdesignsystem.md` IN FULL first; shipped Programs/Builder code wins over the doc. Import shared tokens from `program-builder/builder-tokens` and shared components from `components/programs/shared/**` — never rebuild them.

**Layout call**: stay in the content area (`space-y-5` rhythm, PAGE scrolls, weekday header `sticky top-0 z-20 bg-[#f4f7f6]`) — no full-bleed (a month is bounded; `TrainingPlanHistory` stays below). Kill the `max-h-[600px]` inner scroll.

1. **New `components/clients/training/training-plan-hero.tsx`** (~160): program-top-bar-style dark hero (`bg-[#0f2027] rounded-[6px] px-5 py-3.5`, `HEADER_EYEBROW_CLASS` "Training plan", name `text-[17px] font-semibold text-white`, mono stat row `{freq}×/wk · {weeks} wk · {completed}/{planned} this wk · {adherence}%` — week stats from the existing summary endpoint the old `TrainingSummaryHero` uses). Actions: **"Edit plan"** teal primary (`bg-[#0d9488] hover:bg-[#0b7f75]`, `Pencil h-3.5 w-3.5`) rendered **only when `onEditPlan` prop provided** (Job 2 wires it — hidden until then) + "Apply program" outline-on-dark → `onOpenGenerator`. Owns the empty branch (move the dark empty hero in from the right panel; fix its invented `hover:bg-[#0f766e]` → `#0b7f75`). `TrainingSummaryHero` itself is untouched (still used by the Data subtab).
2. **`builder/training-builder-right-panel.tsx`**: mount the hero (both branches); own the relocated "Delete future sessions" dialog; `space-y-5`; loading = centered `Loader2 h-6 w-6 animate-spin text-[#93b0b4]` in `py-24`. Retarget `training-builder-right-panel.test.tsx`.
3. **`builder/training-plan-builder.tsx`** (290 → ~180): TopContentBar slims to the subtab control (swap hand-rolled segmented for shared `<SegmentedControl>`) + phase info; EditMode toggle, Apply program, and Delete-future move into the Plans surface; delete the now-unused `EditModeButton` export in `training-plan-helpers.tsx`.
4. **New `calendar/calendar-tokens.ts`** (~45):
   - `CAL_GRID_COLS = "grid grid-cols-[42px_repeat(7,minmax(0,1fr))] gap-2"`
   - `PHASE_TINT`: active `bg-[rgba(13,148,136,0.06)]`, planned `bg-[rgba(13,148,136,0.03)]`, completed `bg-[rgba(0,0,0,0.02)]` (purges blue `rgba(59,130,246,…)` / slate `rgba(148,163,184,…)`).
   - `STATUS_THUMB` map (replaces raw-Tailwind dots): scheduled = `bg-[rgba(13,148,136,0.08)]` + `Dumbbell text-[#0d9488]`; completed = same bg + `Check text-[#0d9488]` (strokeWidth 2); partial = `bg-[rgba(245,158,11,0.07)]` + `Minus text-[#d97706]`; missed = `bg-[rgba(192,96,96,0.08)]` + `X text-[#c06060]`; skipped = `bg-[rgba(0,0,0,0.03)]` + `Ban text-[#93b0b4]` + card `opacity-70`.
5. **`calendar/calendar-event-card.tsx` rewrite** (~150): builder card language — white, `TRAINING_CARD_BORDER`, `rounded-[6px]`, hover-lift, status thumb `h-5 w-5`, name `text-[12px] font-semibold text-[#0c1a1e]`, mono meta row (focus left, `+N%` surplus right `text-[#0d9488]`), modified `Pencil h-2.5 w-2.5 text-[#93b0b4]`, hover-revealed kebab. **Constraints**: root stays a `div`; the kebab remains the ONLY real `<button>`; drag data/gating (`disabled: !editMode || !isFutureScheduled`) unchanged — `calendar-event-card.test.tsx` must pass **unmodified**. Kebab Delete now opens a dialog (below) instead of `confirm()`; Delete item `text-[#c06060]`.
6. **`calendar/calendar-day-cell.tsx` rewrite** (~140): `min-h-[96px] rounded-[6px] p-1.5`, phase tint, out-of-month `opacity-40`, past `opacity-60`, today `ring-1 ring-[#0d9488]` (purges `ring-teal-500`), drag-over `border-dashed border-[#0d9488] bg-[rgba(13,148,136,0.05)]`, mono date numeral (today `text-[#0d9488]`), rest = centered `MONO_LABEL_CLASS` "Rest" (no standing dashed border — dashed appears on drag-over only). `MAX_VISIBLE_EVENTS = 3`; "+N more" → 320px Popover (design-doc recipe) listing full event cards (click-through to the tray).
7. **New `calendar/calendar-week-rail.tsx`** (~95): always-rendered 42px rail (kills the edit-toggle column shift) — W# chip (`bg-[rgba(13,148,136,0.08)] font-mono-display text-[10.5px] font-semibold text-[#0a5c55]`) + session count `text-[9.5px] text-[#c2d0cc]`; edit-mode hover kebab (`MoreVertical h-3 w-3`) with Duplicate-to-next (`Copy`), Duplicate-to-remaining (`CopyPlus`), Save-as-plan (`Save`), Clear-week (`Trash2 text-[#c06060]`).
8. **`calendar/calendar-week-row.tsx`** (→ ~100): `CAL_GRID_COLS`, rail + 7 cells; **new `calendar/calendar-grid.tsx`** (~110): sticky Mon–Sun header (`MONO_LABEL_CLASS`, first cell empty), `space-y-2` rows, keep scroll-to-today.
9. **New `calendar/calendar-toolbar.tsx`** (~90): month prev/next icon actions, mono month label (`font-mono-display text-[13px] font-semibold`), "Today" chip, spacer, Library chip-toggle (edit mode), View/Edit `<SegmentedControl>`. Below it `<SectionLabel label="Schedule" meta={monthSessionCount + " sessions"} actions={rail}>` with the Delete-future trigger (`Trash2` hover `#c06060`).
10. **Dialogs** — all on the styled `Dialog` primitive (NOT `ConfirmDialog`/AlertDialog — that primitive is un-migrated OKLCH): **new `calendar/delete-event-dialog.tsx`** (replaces `confirm()`; danger thumb + "Remove session?" + destructive CTA + spinner) with co-located `ClearWeekDialog` (NEW confirm for the currently-unconfirmed clear-week: "Removes all scheduled sessions from the week of {date}. Completed and past sessions are kept."); **new `calendar/save-week-dialog.tsx`** (extracted + on-recipe, prefilled name); **`move-scope-dialog.tsx`** restyle only (`accent-[#0d9488]`, teal radio rows, mono dates).
11. **`calendar/library-panel.tsx` rewrite** (~230): keep Sheet mechanics + drag-data shapes (`{type, id, plan|session}` — the dnd hook reads `.id`); restyle to builder-panel card language (`SegmentedControl` Plans/Sessions, `THUMB_CLASS` cards, grips, `MONO_LABEL_CLASS` metas, `CHIP_NEUTRAL_CLASS`, doc empty-state recipe). Purge `bg-card`/`Badge` defaults/`rounded-md`.
12. **`training-calendar-view.tsx`** shrinks to ~300 lines (extractions above); duplicate-mode banner restyled to teal-alpha (`border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)] text-[#0a5c55]`); every existing mutation path keeps `useInvalidateNutritionCalendar`.
13. **Purge grep** (must return zero across `components/clients/training/calendar/` + the new hero):
    `teal-500|teal-600|teal-800|teal-50|teal-100|teal-200|bg-green-500|bg-amber-500|bg-red-500|bg-gray-400|text-red-600|rgba\(59,130,246|rgba\(148,163,184|accent-teal|bg-card|#0f766e|confirm\(|prompt\(`

## Job 1 commit sequence

1. `feat(training): session full-edit backend — replaceSessionFull PUT + setSpecs schema fix` (1A)
2. `feat(training): builder-grade placed-session tray replaces legacy calendar drawer` (1B incl. deletions + doc sweep)
3. `refactor(training): calendar tokens + event-card/day-cell redesign` (1C items 4–6)
4. `refactor(training): calendar grid frame, toolbar, rail, dialogs` (1C items 7–10, 12)
5. `refactor(training): plans-subtab hero + chrome + library panel redesign` (1C items 1–3, 11, 13)

## Job 1 verification

- Per commit: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (note: `set-tracker.test.tsx` is a known flaky — re-run before blaming your change), no `as any`, no leftover TODO/FIXME/DEBUG.
- Browser smoke (dev server; note `next dev` may bind IPv6-only): open a client → Training → Plans. Tray: click a session → edit per-set specs/drop sets/rename/video → Save → calendar card updates + nutrition tab reflects surplus change. Shared session (duplicate an event first) → scope dialog both paths. Redesign: hero both branches; month nav/Today/today-ring; sticky weekday header on a 6-week month; View↔Edit with no column shift; week-rail kebab all 4 actions incl. new clear-week confirm; drag-move → MoveScopeDialog; library drag (plan → ApplyToClientDialog, session → rest day); event kebab duplicate + delete dialog; 4+ events → "+N more" popover click-through; status thumbs all 5 states; phase tints; out-of-month dimming.
- Append a STATUS block (below) before finishing.

---

# JOB 2 — Plan amendments + AI assistant on placed plans

**Prerequisite**: Job 1's STATUS block below reports SHIPPED (the tray, `placed-serialize.ts`, the hero's `onEditPlan` seam, and `useInvalidateTrainingCalendar` must exist). If missing, STOP and tell the user.

Core design: **one lock source** — locks derive from a serializable `lockedSlotUids: string[]` + the draft via a pure React-free lock model shared by grid rendering, dnd, provider-wrapped mutators, and `applyDraftOp` ctx (server executor and client replay build the same Set from the same array → cannot drift). Lock rule per slot: `slotDate(position) < clientToday OR (linked event exists && status !== 'scheduled')`. **Server is the boundary authority**: the amend PUT recomputes `floor`/`offset` itself and ignores incoming content at past positions; drift is caught by an `amendmentToken` → 409.

## 2A. Backend: amendment reader + writer

1. **Prerequisite refactor**: extract `generateProgramEvents` + `calculatePlacementEndDate` from `services/library-placement-service.ts` (731 lines) into new `services/program-event-walk.ts`; add `startPosition?: number` (default 0) to the walker (`let slotPosition = startPosition ?? 0`, keep the modulo). Update `library-placement-service.test.ts` mocks (mock-contract rule, CONVENTIONS §2).
2. **New `services/plan-amendment-service.ts`**:
   - `getPlacedPlanForBuilder(clientId, planId)` → `{plan: {id, name, splitType, programDurationWeeks, frequencyPerWeek, effectiveFrom, phaseId, savedPlanId, status, updatedAt}, clientToday, windowEnd (recomputed via the shared calculator), isFullyPast, amendmentToken, sessions: PlacedSlotRead[], futureModifiedEvents: [{id, date, sessionName}]}`. `PlacedSlotRead` = ALL active session rows **including rest** ordered `(week_index, order_index, created_at, id)`, full-fidelity exercises (chunked + paged reads — copy `fetchAllByChunkedIds` from `client-training-plan-service.ts`; the client-portal reader is lossy, do NOT reuse it), `sessionType` synthesized `"training"`, per-slot `events: [{id, date, status, isModified}]` linkage (one plan-scoped paged event read grouped by session id).
   - `computeAmendmentToken(...)` = `base64url(sha256(JSON.stringify({planUpdatedAt, clientToday, futureEventTuples})))` where tuples = `[id, date, training_session_id, status, is_modified]` for every event the amendment's delete predicates would match, sorted by id. ONE helper used by both GET and PUT.
   - `amendPlacedPlanFuture({clientId, coachId, planId, sessions, planPatch?, expectedToken})` throwing `AmendmentConflictError` (→409) / `AmendmentEmptyFutureError` (→422). Algorithm:
     1. Load plan; verify `client_id`, `deleted_at IS NULL`, `status != 'archived'`.
     2. `today = getClientTodayString(clientId)`; `floor = max(effective_from, today)`; `offset = daysBetween(effective_from, floor)`.
     3. Token check (recompute vs `expectedToken`) → 409 on mismatch.
     4. Structural validation: `sessions.length % 7 === 0`; after `(weekIndex, orderIndex)` sort, `orderIndex === index` for every slot (the serializer guarantees `weekIndex*7+day`); `offset >= sessions.length` → 422.
     5. `windowEnd = calculatePlacementEndDate({phaseId, clientId, slotCount: sessions.length, startDate: effective_from})` (phase cap + `getNextPlanStartCap` re-applied); `windowEnd < floor` → 422.
     6. Partition existing rows (same canonical sort): `keepIds` = positions `< offset` ∪ rows referenced by any surviving event (`training_plan_id = planId AND (date < floor OR status != 'scheduled')` — the event-reference belt that makes diverged plans safe); rest → `deactivateIds`.
     7. H3 snapshot (paged, both delete predicates from step 10, dedupe by id).
     8. Insert fresh future sessions (positions `>= offset`; placement clone shape: `day_of_week: null`, week/order from input, rest rows forced name "Rest"/null focus/null surplus) + exercises (**verbatim splat** incl. `set_specs`/`video_url`; `fetchVisibleExerciseIds` belt for foreign exercise ids). Insert-first ordering.
     9. Soft-delete `deactivateIds` (sessions + their exercises, chunked `.in()`).
     10. Delete future **scheduled** events: (a) `training_plan_id = planId AND date >= floor` (unbounded — catches shrunk windows + moved-out events); (b) `client_id = clientId AND date BETWEEN floor AND windowEnd`. **No `is_modified` filter** (decision 6).
     11. `generateProgramEvents({clientId, planId, programSlots: full slot array with fresh rows at future positions, startDate: floor, endDate: windowEnd, startPosition: offset})` — every event carries `calorie_surplus_percentage` (input value verbatim — absolute semantics), `session_name`/`session_focus`, `status:'scheduled'`, `is_modified:false`; upsert `onConflict (client_id, training_session_id, date), ignoreDuplicates`.
     12. Plan meta: `program_duration_weeks = sessions.length / 7`, `frequency_per_week = deriveFrequencyPerWeek(sessions)` (CHECK 1..7-safe), name/splitType from `planPatch`, `updated_at = now()` (this bump invalidates other holders' tokens). `effective_until` stays NULL.
     13. Catch → compensate (mirror `compensatePlacement`): delete events for fresh session ids → hard-delete fresh exercises/sessions → reactivate `deactivateIds` → re-insert event snapshot in 500-row chunks → rethrow (augment message if cleanup itself fails).
3. **New route** `app/api/clients/[id]/training/[planId]/amendment/route.ts` — GET (reader) + PUT (writer) co-located (token producer/consumer adjacency). Chain: `coachApiRateLimit` → CSRF (PUT) → `getAuthenticatedCoachId(request)` → client ownership → plan-belongs-to-client → zod. Schema `amendPlacedPlanSchema` (`lib/validations/training.ts`): `{sessions: z.array(savedSessionInputSchema).min(7).max(364), plan: z.object({name: 1..100 optional, splitType: ≤100 nullish}).optional(), expectedToken: z.string().min(1).max(300)}` (all-rest futures are legal — an explicit deload). After success: `await cascadeNutritionAfterTrainingChange(clientId, floor, "cascade-nutrition-from-plan-amendment")`; `void recordAuditEvent(...)` with new `AUDIT_ACTIONS.TRAINING_PLAN_AMEND: "training_plan.amend"` (`lib/constants.ts`); `export const maxDuration = 60`. Error mapping: 409 / 422 / 404.
4. **No migrations.**
5. **Tests**: `plan-amendment-service.test.ts` (token stability + each invalidation trigger; boundary math incl. not-yet-started plan `offset=0` and fully-past 422; partition incl. event-reference belt; both delete predicates scheduled-only + no is_modified filter; walk resume — first generated date = floor mapping slot `offset`, rest slots consume dates silently, **assert `calorie_surplus_percentage` key present on every emitted event even when null**; window recompute growth/shrink/phase/next-plan caps; meta updates; compensation restores everything and preserves the root error). `program-event-walk.test.ts` (`startPosition` + zero-offset regression). Route tests: auth chain, 409/422 mapping, cascade anchor = floor, audit fired, non-canonical grid rejected.

## 2B. Frontend: amendment surface

1. **Pure layer** (commit separately — no UI risk):
   - `program-builder-types.ts:10` → `BuilderTarget = "library" | "client-draft" | "placed-plan"`.
   - **New `program-builder/program-builder-lock-model.ts`** (~110, React-free): `PAST_LOCKED` copy, `computeLockedSlotUids(read, draftWeeks)`, `isSlotLocked`, `isSessionLocked`, `weekLockState` ("none"|"partial"|"full"), `lockBoundaryWeekIndex`, `canDeleteWeek`, `canInsertAfterWeek`, `canReorderWeeks`. Policy: weeks at/before the boundary can't be deleted/reordered/inserted-before; duplicate/progress of the boundary week allowed; fully-elapsed week duplicate blocked (decision 8).
   - **Extend `program-builder/placed-serialize.ts`** (created in Job 1): `placedPlanToDraft(read)` → `{draft, lockedSlotUids, sessionIdByUid, amendmentToken, fullyLocked}` — regroup `PlacedSlotRead[]` reusing `savedPlanToDraft`'s dual path (week-shaped when every weekIndex group is exactly 7, else flat repack with rest padding — diverged plans take the flat path and the amendment save normalizes the future); fresh uids per SLOT (a shared session in two slots gets two uids → same DB id); seed `status: "saved"`. `draftToAmendBody(draft, planPatch, token)` on the exported `draftToSessionInputs`.
   - `program-builder-ops.ts`: `DraftOpContext = {target: BuilderTarget, lockedSlotUids?: ReadonlySet<string>}`; skips via lock-model helpers — `place_session`/`clear_slot` on locked slot; `move_session` on locked source-or-target; session/exercise ops on locked session; `remove_week`/`move_week`/`insert_week` via `canDeleteWeek`/`canReorderWeeks`/`canInsertAfterWeek`. `IDENTITY_LOCKED` stays client-draft-only (decision 5). `applyAssistantOps(ops, ctx)` signature change in `use-program-builder-state.ts` (+ call sites/tests).
2. **Provider** (`program-draft-provider.tsx`): props → `{target, savedPlanId?, placedPlanId?, clientId?, clientName?, onApplied?, onAmended?}`; context adds `placedPlanId, lockedSlotUids, fullyLocked, sessionIdByUid, isAmending, amendPlan`; `savedPlanId` nullable (its consumers are library-gated). Keep the provider small by composing two new hooks: **`hooks/use-placed-plan.ts`** (~40, SWR on the amendment GET, key nulled unless placed-plan) and **`program-builder/use-placed-plan-source.ts`** (~100: seed-once via `placedPlanToDraft`, opens in edit mode, token ref, placed `discardChanges` branch re-seeding + recomputing locks, non-amendable/legacy error state). `beforeunload` gate: library **+ placed** (placed has a real save that clears dirty).
3. **Lock enforcement in UI**: **new `program-builder/use-locked-mutators.ts`** (~120) wraps the state's mutators for the placed target (blocked call = no-op + destructive toast `PAST_LOCKED`) — single choke point since every UI path flows through provider mutators. `program-grid.tsx`/`week-row.tsx`/`day-cell.tsx`: optional `lockedSlotUids` prop — locked cells: droppable/draggable disabled, clear-X/grip hidden, `opacity-60` + `Lock h-3 w-3` icon, locked rest cells inert; locked session cards still clickable but open `SessionEditorSheet` with `mode="view"`. `week-card.tsx`: add `canDuplicate`/`canProgress` props (computed via lock model in `program-builder.tsx`). `use-program-dnd.ts`: `slotAcceptsDrag` returns false for locked slots; week-drag excludes locked weeks (`isWeekLocked` param); belt-check in `handleDragEnd`.
4. **Save**: **new `program-builder/use-amend-plan.ts`** (~130), sibling of `use-client-apply.ts`: `requestAmend` opens a confirm dialog ("Save changes to {clientName}'s plan? Future sessions and their calendar dates will be updated. Days that already happened are untouched." + when `futureModifiedEvents.length > 0` a warning list: "N manually-moved future sessions will be re-laid") → `confirmAmend` snapshots `getRevision()`, builds `draftToAmendBody`, PUTs; 200 → `markSaved(revision)` (mid-save edits → "kept-draft" + "save again" toast, mirroring `saveProgram`); 409 → drift dialog ("This plan changed while you were editing — reload and lose unsaved edits, or keep editing and retry"; reload = `mutatePlacedPlan()` + re-seed); other errors toast + stay.
5. **Chrome** (`program-builder.tsx`): `isPlacedPlan` gating — "Save changes to plan" teal button in the SectionLabel rail (`disabled={!isDirty || isAmending || assistantBusy}`); back label "Back to calendar"; Save-program/Delete gated to `target === "library"`; create-blank in-memory for `target !== "library"`; `identityEditable` stays `!isClientDraft` (placed = editable); library panel stays (dragging into future slots is in scope); opens in edit mode; `fullyLocked` → banner "This plan has ended — nothing left to edit" + save suppressed. If the file exceeds ~620 lines, extract the DragOverlay block into `builder-drag-overlay.tsx`.
6. **Mount**: **new `components/clients/training/builder/plan-amendment-overlay.tsx`** (~120) cloning `training-plan-builder-overlay.tsx`'s editor state (non-modal DialogPrimitive, full-screen `lg:left-[52px]`, Escape/outside neutralized, leave-guard reused): `ProgramDraftProvider key={planId} target="placed-plan" placedPlanId clientId clientName onAmended={() => {void fetchPlan(); void invalidateTrainingCalendar(clientId); void invalidateNutritionCalendar(clientId); close();}}`.
7. **Entry wiring**: `TrainingBuilderRightPanel` owns `amendOpen`; threads `onEditPlan` to the hero button (Job 1 seam — button appears now) and through the calendar view into the tray's "Edit whole plan" menu item. Disabled + tooltip when `isFullyPast`.
8. **Tests**: lock-model unit suite; `placed-serialize.test.ts` (round-trip vs a `draftToSessionInputs` fixture; diverged-plan flat path; fresh-uids-per-slot for shared sessions); ops lock-skip suite; dnd locked-collision; day-cell locked states; placed-target chrome suite in `program-builder.test.tsx` (button presence/absence, amend body incl. token, 409 keeps draft).

## 2C. Assistant `placed-plan` target

1. `lib/validations/assistant.ts`: target enum + `planId: z.string().uuid().optional()` + `lockedSlotUids: z.array(z.string()).max(400).optional()`; refines — placed-plan requires `clientId` AND `planId` AND `lockedSlotUids`; both new fields forbidden for other targets.
2. Route (`app/api/training/assistant/route.ts`): after the existing clientId IDOR block, for placed-plan verify the plan belongs to that client (`getTrainingPlanById`) → 404. Still zero DB writes in a turn.
3. `services/assistant/draft-workspace.ts`: materialize `lockedSlotUids` Set from the wire array (unknown uids ignored); entry fingerprints of locked-slot content; `finalizeAssistantOps` — for placed-plan SKIP the identity sweep, ADD a locked sweep (discard the turn's ops with a note if any locked slot's final content differs from entry).
4. `services/assistant/draft-agent-service.ts` `systemPrompt`: placed-plan branch — "this is a CLIENT'S live placed program; days before the lock boundary are history and ops touching them will be skipped; renames ARE allowed; nothing reaches the calendar until the coach saves." (Prompt grows — safe direction for the 4096-token cache floor; check `prompt-size.test.ts`.)
5. `use-assistant-chat.ts`: send `clientId` when `target !== "library"`, plus `planId`/`lockedSlotUids` for placed-plan; `applyOps` replays with the same `{target, lockedSlotUids}` ctx. The dock is mounted inside `ProgramBuilder` — works on the amendment surface for free.
6. **Tests**: schema refine matrix; locked-op skip + locked-sweep discard; identity sweep NOT applied for placed-plan (rename survives); route 400/404 paths.

## Job 2 commit sequence

1. `refactor(training): extract program-event-walk with startPosition resume` (2A.1)
2. `feat(training): plan amendment backend — reader, token, amend-future writer + route` (2A.2–5)
3. `feat(training): placed-plan builder target — pure layer (lock model, serialize, ops ctx)` (2B.1)
4. `feat(training): plan amendment surface — provider, locks, save, overlay, entry points` (2B.2–8)
5. `feat(assistant): placed-plan target with past-slot locking` (2C)
6. `docs(training): amendment flow + placed-plan editing reconciliation` (ARCHITECTURE.md: amendment flow + new routes under the training section; CONVENTIONS touch-ups if any rule text went stale; TECHNICAL-DEBT.md for anything deliberately deferred)

## Job 2 edge cases (behavior spec)

| Case | Behavior |
|---|---|
| Plan fully past (`windowEnd < clientToday`) | GET `isFullyPast`; PUT 422; entry disabled + tooltip |
| Amendment shrinks below elapsed days (`offset >= slotCount`) | 422 (UI also blocks deleting locked weeks) |
| Entire future made rest | Legal — events deleted, none created, freq clamps 1 |
| Program grows past old window | Recomputed cap (phase + `getNextPlanStartCap`) bounds the walk |
| Concurrent edit / calendar move / client midnight flip | Token 409 → reload-vs-keep-editing dialog |
| Diverged plans (duplicate-week/cloned-day colliding coords) | Deterministic sort + flat regroup; event-reference belt keeps past-referenced rows; amendment normalizes the future to the positional model |
| Legacy weekday plan (`day_of_week` set) | Future migrates to positional model (new rows `day_of_week: null`); past rows untouched |
| Future event already logged/completed early | Slot locked in UI; session row kept via event-reference belt; event survives (scheduled-only deletes) |
| Manually-moved (`is_modified`) future events | Deleted by the rewrite; listed in the pre-save warning |
| Rename (session or plan) | Future scheduled events re-snapshotted; past keeps old names |

## Job 2 verification

- Per commit: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (flaky `set-tracker.test.tsx` — re-run before blaming your change).
- Browser smoke: place a multi-week program on a fixture client → "Edit plan" from the hero → past weeks greyed/locked (drag, edit, delete all refused with toast), future editable → structural edit (add a week, swap two days) + prescription edit (drop a load) → Save → confirm dialog (incl. moved-events warning if applicable) → calendar re-laid, past untouched, nutrition calendar refreshed. Amend again immediately (token round-trip). Assistant on the amendment surface: "reduce all remaining loads by 10%" → ops applied to future only; ask it to edit a past week → skipped with reason. Tray "Edit whole plan" link opens the overlay.
- Append a STATUS block before finishing.

---

## STATUS blocks (append below — MANDATORY completion protocol)

Each job session appends on completion: what shipped (commits + hashes), deviations from this spec (recorded deviations win over the prose above), test/smoke results, anything deferred.

<!-- JOB 1 STATUS: SHIPPED 2026-07-22 -->

## JOB 1 STATUS — SHIPPED (2026-07-22)

**Commits (main):**
1. `9afba50` 1A — replaceSessionFull PUT + extended GET (`events[]`+`clientToday`) + updateExerciseSchema setSpecs/videoUrl fix + service/route/schema tests
2. `75ca7ee` 1B — placed-session tray (placed-serialize, use-placed-session-editor, placed-session-editor), drawer + `sessions/` deleted, doc sweep, `useInvalidateTrainingCalendar`, tray test suite
3. `358bce4` 1C.4–6 — calendar-tokens (CAL_GRID_COLS / PHASE_TINT / STATUS_THUMB), event-card + day-cell rewrites (card test passed unmodified)
4. `5b90454` 1C.7–10,12 — week rail, grid frame (sticky header, page scroll), toolbar, delete-event/clear-week/save-week dialogs, move-scope restyle
5. `8f5556d` 1C.1–3,11,13 — training-plan-hero, right-panel/chrome slim-down, library-panel restyle, purge grep zero
6. `8fb2eac` smoke follow-up — mono-in-prose fixes (3 dialogs), toolbar merged into the Schedule divider, design-doc overlay/toast spec
7. `390822f` divider polish round 2 (owner feedback) — label-less quiet divider + icon edit toggle, Today = month-switch only (scroll-to-today removed), hero stat row removed, builder rail icon order stable (Save left / Delete always rightmost — rule recorded in the design doc)

**Gates:** every commit green on `npx tsc --noEmit`, `npx eslint .` (0 errors), full `npx vitest run` (2076→2088 tests; `set-tracker.test.tsx` flaked once, passed in isolation). Final purge grep (1C.13) = zero.

**Recorded deviations (win over the prose above):**
1. Tray day-scope save = clone-with-overrides **+ the replace PUT on the clone** (spec said clone only) — closes the day-scope meta/rename drop and event-snapshot staleness the clone route leaves; both scopes get identical builder-grade semantics.
2. Save-week already had a styled dialog (no `prompt()`); work was extract+restyle into `save-week-dialog.tsx`. The only `prompt()` was the drawer's save-to-library (replaced by the tray's dialog).
3. Event-delete `confirm()` lived in the view's onDelete handler, not the card kebab — `delete-event-dialog.tsx` replaced the view-level confirm; card API unchanged.
4. `training-calendar-view.tsx` landed at ~640 lines, not ~300 — the remainder is mutation orchestration entangled with dialog state; splitting it would thread six setters through a hook (CONVENTIONS §4: cure worse than disease).
5. No pre-existing test existed for the coach `sessions/[sessionId]` route — the route suite was written fresh on the established mock idiom.

**Browser smoke:** run by the owner (agent-side headless harness was aborted by a machine-level macOS Desktop-permission failure mid-session). Findings: (a) mono dates in dialog prose — FIXED in `8fb2eac` + rule codified in `docs/newdesignsystem.md` ("Prose vs data"); (b) toolbar merged into the Schedule divider per owner preference — SHIPPED in `8fb2eac`; (c) move-scope "This and all future X sessions" is effectively single-event under the 1:1 placement invariant (one session row per day since mig 121; only duplicated events share a session) — pre-existing semantics, NOT a Job 1 regression; bulk mid-plan change is Job 2's amendment surface. Revisit that option's wording/presence when Job 2 ships. Not smoked: nutrition-tab surplus reflection (smoke client had no nutrition plan; the cascade call is covered by route tests + the PATCH path is unchanged).

**Job 2 seams in place:** `placed-serialize.ts` (with `exerciseIdByUid` row-id map), hero `onEditPlan` prop (button hidden until wired), tray "Edit whole plan" menu item (renders only when `onEditPlan` provided), `useInvalidateTrainingCalendar`, `onEditPlan` threaded through `TrainingCalendarView`.

**Deferred:** move-scope option rewording (Job 2); `superset_group`/`is_warmup` doc notes updated (last `is_warmup` writer deleted with the drawer — see CONVENTIONS §8 / TECHNICAL-DEBT).

<!-- JOB 2 STATUS: SHIPPED 2026-07-22 -->

## JOB 2 STATUS — SHIPPED (2026-07-22)

**Commits (main):**
1. `b24ee30` 2A.1 — `services/program-event-walk.ts` extracted (`generateProgramEvents` + `calculatePlacementEndDate`, exported, `startPosition` resume) + walk test suite
2. `e4de6b3` 2A.2–5 — `plan-amendment-service.ts` (reader / `computeAmendmentToken` / 13-step `amendPlacedPlanFuture` + compensator), `GET`+`PUT .../[planId]/amendment` route, `amendPlacedPlanSchema`, `AUDIT_ACTIONS.TRAINING_PLAN_AMEND`; 28-case service suite on a state-mutating interpreted supabase harness + 16-case route suite
3. `61a9f4f` 2B.1 — `BuilderTarget` + `"placed-plan"`, `program-builder-lock-model.ts`, `placedPlanToDraft`/`draftToAmendBody` in placed-serialize, `DraftOpContext.lockedSlotUids` + per-op PAST_LOCKED skips, `applyAssistantOps(ops, ctx)` signature; lock-model / placed-serialize / ops-lock suites
4. `75fc7c8` 2B.2–8 — provider placed source (`use-placed-plan`, `use-placed-plan-source`, `use-locked-mutators`, `use-amend-plan`, `amend-plan-dialogs`), grid/dnd lock rendering + belts, placed chrome, `plan-amendment-overlay.tsx`, right-panel entry wiring (hero button + tray item, `isFullyPast` gate); placed chrome / locked dnd / locked day-cell suites
5. `65db6c5` 2C — assistant `placed-plan` target (schema refine matrix, route plan-ownership 404 + lock-set forwarding, workspace lock materialization + locked sweep, prompt arm, chat-hook body/replay ctx); route + executor-skip + sweep suites
6. (this commit) docs — ARCHITECTURE amendment section + three stale-reference updates, CONVENTIONS §6 training-UI map, TECHNICAL-DEBT deferrals, this STATUS block

**Gates:** every commit green on `npx tsc --noEmit`, `npx eslint .` (0 errors), full `npx vitest run` (2102 → 2202 tests; `set-tracker.test.tsx` did not flake this session). No migrations; the working tree's pre-existing `types/database.ts` + migration 129 files were left untouched and excluded from every commit.

**Recorded deviations (win over the prose above):**
1. `library-placement-service.test.ts` needed NO mock updates for the 2A.1 extraction — the new module imports the same mocked deps, so the module-graph mocks held transitively; existing placement tests passed unmodified.
2. The PUT rejects a fully-elapsed plan against the CURRENT window (`currentWindowEnd < floor` → 422) at the token stage, not only via step 5's NEW-window check — without this, a longer payload could extend an ended plan, violating decision 8's edge-row ("Plan fully past → PUT 422").
3. `fetchVisibleExerciseIds` was exported from `library-placement-service.ts` and reused (not copied) as the amendment's foreign-exercise belt.
4. The provider context exposes the full `amend` API group (confirm/drift dialog state + actions) alongside the spec's flat `isAmending`/`amendPlan` keys; the dialogs live in a new `amend-plan-dialogs.tsx` on the styled Dialog primitive (never ConfirmDialog, per the design SOT), with the moved-events warning inside the confirm.
5. Week lock policies (drag/delete/duplicate) are computed in `week-row.tsx` via the shared lock model, not in `program-builder.tsx` — same single source, less prop plumbing. `canDuplicateWeek` was added to the lock model beyond the spec's export list.
6. After a save that raced mid-save edits ("kept-draft"), the source hook refreshes the drift token WITHOUT re-seeding (`refreshToken`) so the follow-up save doesn't 409 against our own amendment — the spec's save flow implied but didn't specify this.
7. `ClientDraftLeaveGuard` gained an optional `description` prop so the amendment overlay's guard copy says "save", not "apply".
8. The right-panel `isFullyPast` gate reuses the full amendment GET (shared SWR key with the overlay) — logged in TECHNICAL-DEBT as a payload-size tail, not changed.
9. The assistant's locked sweep also discards when a locked slot VANISHED (its week removed) — "content differs from entry" includes non-existence.

**Test/smoke results:** 2202 tests green across 227 files (~112 new). **Browser smoke NOT run agent-side** — Job 1 recorded a machine-level macOS Desktop-permission failure in the CDP harness, so the Job 2 checklist is handed to the owner (place multi-week program → "Edit plan" from hero → past locked with toast on drag/edit/delete → structural + prescription edit → Save → confirm incl. moved-events warning → calendar re-laid, past untouched, nutrition refreshed → immediate re-amend (token round-trip) → assistant "reduce all remaining loads by 10%" future-only, past-week edit skipped with reason → tray "Edit whole plan" opens the overlay). The amendment cascade + audit are covered by route tests; the token round-trip, resumed walk, and compensation by the service suite.

**Deferred:** move-scope option rewording (owner copy decision — see TECHNICAL-DEBT "Plan amendment — deferred tails"); lean summary variant of the amendment GET if the entry-point gate ever shows in traces.

---

## Paste-able prompts

### Prompt — Session 1 (Job 1)

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full. Then read
docs/PLACED-PLAN-EDITING-EXECUTION-PLAN.md in full — it is the approved spec, produced after
full exploration; its "Owner decisions" and "Verified architecture facts" are final, do not
re-litigate them (but re-verify file/line facts against current code as you go).

You are executing JOB 1 (sections 1A, 1B, 1C): the builder-grade placed-session tray replacing
the legacy calendar drawer, plus the Teal-Summit redesign of the Training→Plans subtab.

Before your first edit, present a brief execution summary (the 5-commit sequence with what each
touches) and wait for my go. Then work through the Job 1 commit sequence on main, gating every
commit on: npx tsc --noEmit, npx eslint ., npx vitest run (set-tracker.test.tsx is a known
flaky — re-run before blaming your change). Finish with the Job 1 browser-smoke checklist and
append the JOB 1 STATUS block to the plan doc (commits, deviations, results, deferrals).
```

### Prompt — Session 2 (Job 2)

```
Read CONVENTIONS.md, docs/ARCHITECTURE.md, and docs/newdesignsystem.md in full. Then read
docs/PLACED-PLAN-EDITING-EXECUTION-PLAN.md in full — it is the approved spec; its "Owner
decisions" and "Verified architecture facts" are final, do not re-litigate them (but re-verify
file/line facts against current code as you go).

You are executing JOB 2 (sections 2A, 2B, 2C): the plan-amendment backend (rewrite-future with
drift token), the amendment surface (shared builder grid over a placed plan, past locked), and
the AI assistant's placed-plan target.

FIRST verify the prerequisite: the plan doc's JOB 1 STATUS block reports shipped, and
components/clients/training/calendar/placed-session-editor.tsx,
components/clients/training/program-builder/placed-serialize.ts, and useInvalidateTrainingCalendar
(hooks/use-calendar-events.ts) exist. If not, STOP and tell me.

Before your first edit, present a brief execution summary (the 6-commit sequence with what each
touches) and wait for my go. Then work through the Job 2 commit sequence on main, gating every
commit on: npx tsc --noEmit, npx eslint ., npx vitest run (set-tracker.test.tsx is a known
flaky). Finish with the Job 2 browser-smoke checklist and append the JOB 2 STATUS block to the
plan doc (commits, deviations, results, deferrals).
```
