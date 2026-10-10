# Perf — every page makes the calls its screen needs, and every multi-table save is one transaction

**STATUS: PLANNED 2026-10-10, nothing built.** 22 commits in §6 plus P10 (the load test), one week at the owner's
pace (§6 "The week"). Origin: the read-only performance review of 2026-10-10 (two reports in the owner's session: the
three flows, then every page). This plan is its fix list, ordered by mechanism, not by page.

**Order of everything:** P0 first — the rules into CONVENTIONS, the counter and the gate, so every later line is
written against them — then `docs/SUNSET-PLAN.md` S1–S3, then P1 onward. **Re-cut 2026-10-10 for the sunset,** which
removes the AI check-in review, its draft reply and the Journey blocks before P1 (so no commit here tunes code about
to be deleted; P1 re-writes P0's baselines over the surviving routes). The re-cut removed P8a (the check-in AI job), the AI step from P2a and §7.1, the AI route from
P6b and P4c, the journey route's items from P3b, `use-client-blocks` from P6a, and renamed the client journey route to
`/api/client/goal` in P5b. Every entry below describes the code as the sunset leaves it.

**What the review found, in one paragraph.** From Bali every round trip to the Ireland database costs ~215 ms, and
the codebase makes far too many of them: 7–8 sequential auth hops before any route does work; 130–190 database calls
to paint a coach's client Overview; 29 calls for the client's check-in wizard context; 53 autocommitted statements to
submit a check-in; 16 to save a workout; 14–18 to save a day in the coach's training tray. Co-located in eu-west-1
the same shapes mostly fall under a second, so the first coaches will not feel most of it. Five things are wrong
regardless of location: three writes can lose data on a mid-way failure (check-in submit, workout save, tray save),
two history tabs return wrong rows and a wrong total once a client passes PostgREST's row cap, two dashboard polls
embed every check-in a client ever submitted, the Overview fans out one database call per exercise, and nothing
pins the deployment region. The counts are structural: 64 call sites re-read the client row to learn "today", 75
routes fetch the full client row to compare one id, 49 call sites select every column, 13 write paths run several
autocommitted statements where CONVENTIONS §8 requires one RPC.

**Six mechanisms explain every row of the review's tables.** Each commit below removes one mechanism from every
page it touches, and a gate keeps it removed:
1. Every service resolves its own context (client row, today, week anchor). → §2.1 `ClientContext`, resolved once.
2. Readers recompute instead of sharing (the 7-day figures computed 3× in one request). → §2.6 one week reader.
3. Pagination in memory after a whole-history read. → §2.5 paged in the database.
4. Whole objects for a few fields (the whole program for eight plan fields; `select("*")` ×49). → §2.7 narrow reads.
5. Invalidation by prefix (every calendar write refetches a 210 kB program). → §2.7 exact keys.
6. Multi-statement writes without a transaction (13 paths). → §2.4 atomic RPCs.
And underneath them, nothing counted: tests mock the database, so a 53-statement route passes like a 3-statement
one. → §2.3 the counter and `check:perf`, built first.

**What a coach or client sees change:** nothing but speed, with three exceptions that are corrections. The Training
and Nutrition history tabs show the right rows and the right total however long the client has trained. A save
either saves everything or nothing, and the toast tells the truth (today a save can be stored and still say
"Couldn't save").

---

## 1. Frame

- **Who this is for.** The owner building alone, 12–14 h a day, aiming to have the first coaches on the platform by the
  end of October 2026, and to build the client app (`CLIENT-APP-REFERENCE.md`, the `/api/client/**` contract) straight
  after. Commits P0–P3d (Days 1–4) are the set that lands before any real user. P4–P9 change no response a screen or
  the app reads, so the app can be built after Day 4 while they land.
- **Not in this plan.** The Better Auth PROD switch (`docs/BETTER-AUTH-PLAN.md` §8.2) — it is on the path to users and
  this plan's migrations go to PROD after it, in order (§8). Commit 10.5 of that plan (pool idle time, keep-alive,
  Better Auth joins) — built from its own entry, before P1 here. The coach chat (`docs/COACH-CHAT-PLAN.md`). The
  sunset of the AI reviews and blocks (`docs/SUNSET-PLAN.md`, lands after P0 and before P1). Any UI redesign. Collapsing the
  Overview's 14 requests into fewer routes (the routes get cheap; their number is a later question with real traffic).
  The web app's client-side bootstrap (shell → script → session → profile → data) — the web is the harness and the app
  is the product. A durable job queue — nothing left after the sunset needs one.
- **What the code cannot settle.** Call counts predict the shape of load, not its ceiling. P10 measures the ceiling on
  DEV with the scale seed; the compute tier, the Upstash plan, the Vercel plan and the pooler's connection limit are
  then sized from what it shows (§9). Those are operations decisions, not commits.
- **Frame test (CONVENTIONS §7).** Not needed: no surface changes owner.

---

## 2. Target shape

### 2.1 One client per request: `ClientContext` (`lib/client-context.ts`)

```ts
export type ClientContext = {
  client: {            // the narrow row, never `*`
    id: string; coachId: string; name: string; active: boolean;
    timezone: string | null; coachTimezone: string | null;
    startDate: string | null; nextCheckInDue: string | null;
    unitPreference: "metric" | "imperial" | null;
  };
  today: string;       // the client's calendar day, resolved once (today-service's rule)
  weekAnchor: { weekday: number; nextCheckInDue: string | null; startDate: string | null }; // check-in-week-service's rule
};
```

- **Who makes it.** `requireCoachOwnsClient(clientId, request?)` returns `{ coachId, ctx }`; `requireClientAuth(request)`
  returns `{ clientId, ctx }`. One `clients` read with the `coaches!clients_coach_id_fkey(timezone)` embed, the eight
  columns above. `today` and `weekAnchor` are computed from that row in memory by the pure functions the two
  services already contain (their SQL reads become dead and are deleted in P4c).
- **Who takes it.** Every service that today calls `getClientById`, `getClientTodayString`, `getCoachTodayString` or
  `getClientWeekAnchor` for a client it was handed takes `ctx` (or `ctx.today`, `ctx.weekAnchor`) instead. A service
  that is handed a client id and resolves its own context is the mechanism this plan removes; after P4c the three
  resolvers are importable from `app/api/**` and `lib/**` only (`check:perf` rule B).
- **The full row.** `getClientById` (`*` + the two measurement-view embeds, `services/client-service.ts`) stays for the
  one place that returns the whole client to a screen: `GET /api/clients/[id]` and `GET /api/client/me`. Nowhere else.

### 2.2 Budgets (D2)

| What | Budget |
|---|---|
| A GET route, after auth | ≤ 6 database calls, ≤ 3 of them sequential |
| A write route, after auth | ≤ 3 reads + 1 RPC (or 1 statement) |
| A page's first paint, app routes only, chrome excluded | no more requests than today's count (`scripts/perf-routes.ts` records it) and each within its route budget |
| A route's JSON body | ≤ 50 kB, except the plan editor's read and the builder's template read |
| Any read that can exceed one page | paged in the database (keyset, §8), never read whole and sliced |

Budgets are numbers in `scripts/perf-routes.ts`, one row per route: path, role, fixture, budget, and the count
measured when the row was added. `scripts/perf-count.ts` measures; `check:perf --enforce` (from P4c) fails on a
route over budget.

### 2.3 The counter and `check:perf` (P0)

- **`lib/perf/db-calls.ts`.** When `PERF_COUNT=1`, patches `supabaseAdmin.from` / `.rpc` (the shape of
  `scripts/perf-baseline-wrapper.ts`, which moves here and is imported by the baseline harness) and `authPool.query`
  in `lib/auth.ts`, and prints one line per call to the server's stdout:
  `[db] postgrest clients select 212ms 1 row 1.8kB` / `[db] rpc get_exercise_prs 340ms` / `[db] pg session 215ms`.
  When no call has happened for 300 ms it prints a summary of the burst: `[db-burst] 29 calls · serial ≈ 5 · 1.9 s`
  ("serial" = the greedy count of non-overlapping calls, the critical path's lower bound). Off (`PERF_COUNT` unset)
  it is a no-op import: production builds carry nothing.
- **`scripts/perf-count.ts`.** Starts the proof server (`scripts/proof-server.ts`) with `PERF_COUNT=1`, signs in as the
  perf fixtures (`scripts/perf-fixtures.ts`, `scripts/auth-fixtures.ts`), requests each route in
  `scripts/perf-routes.ts` one at a time, counts the `[db]` lines the server printed between request and response
  (the server's `output` array), and prints: route, calls, serial, ms, bytes, budget, over/under. `--enforce` exits
  non-zero on any route over budget. `--write` records the measured counts as the rows' baselines.
- **`scripts/check-perf.ts` (`npm run check:perf`).** Static rules, each a ratchet against
  `scripts/check-perf-baseline.json` (a commit may not add a violation; phases remove them; `--write` rebaselines):
  - A: `select("*")` / `select('*')` / `` select(`*`` `` in `services/**` and `app/api/**`, outside
    `scripts/check-perf-allowlist.ts` (rows returned whole to a screen).
  - B: `getClientTodayString`, `getCoachTodayString`, `getClientWeekAnchor`, `getClientById` imported anywhere under
    `services/**` other than their own files. A ratchet from P0 (no new call site); from P4c the baseline is zero.
  - C: `.slice(offset` or `.slice(from` in `app/api/**`; `fetchAllPages(` in a route handler that returns a list.
  - D: `mutate(` with a key predicate (a function) in `hooks/**` and `components/**` — the prefix matchers §2.7
    retires. A ratchet from P0; from P6a the baseline is zero.
  - E (from P4c): `perf-count --enforce` over `scripts/perf-routes.ts`, run in the gate when `--routes` is passed
    (it needs DEV; the plain gate runs A–D).
- **Where the numbers go.** Every commit's handover carries `perf-count`'s rows for the routes it touched, before and
  after, side by side. The owner's smokes record the `[db-burst]` lines for the pages they open.

### 2.4 Atomic writes (P2a–P2f): the RPCs

Each is one SQL function (CONVENTIONS §8: SECURITY DEFINER, `REVOKE … FROM PUBLIC, anon, authenticated`, `GRANT
EXECUTE … TO service_role`, optional params `DEFAULT NULL`), one transaction, ownership checked inside from the ids
it is given, and it returns what the caller seeds its cache with, so no re-read follows. Each gets a request-level
proof script (§5) and a smoke (§7). Migration numbers are taken at build time (D20).

| RPC | Replaces | Inside the transaction |
|---|---|---|
| `submit_check_in_atomic(p_client_id, p_today, p_check_in jsonb, p_readings jsonb, p_answers jsonb, p_highlights jsonb, p_next_due date)` | `services/check-in-service.ts submitCheckIn` 4.4–4.8: INSERT check_ins, appendMeasurements, answers insert, clients update, highlights insert | the period-unique guard; INSERT check_ins (with both snapshots); INSERT client_measurements rows (source `check_in`, source_id = the new id; the standing-read "unchanged" rule in SQL); INSERT check_in_answers; INSERT check_in_exercise_highlights; UPDATE clients.next_check_in_due; RETURNS the check_ins row |
| `log_training_event_atomic(p_client_id, p_event_id, p_today, p_log jsonb)` | `services/training-log-service.ts writeSessionLog` (16 statements in 14 waves) | event ownership + status FOR UPDATE; the session snapshot; INSERT/UPDATE session_logs; replace exercise_logs + set_logs (one INSERT each from jsonb); replace session_log_group_scores; link training_events.session_log_id and status; RETURNS the saved log in today's response shape |
| `replace_training_session_atomic(p_client_id, p_plan_id, p_session_id, p_today, p_session jsonb)` | `services/training-session-replace-service.ts` + `bulkReplaceExercises` (14–18 statements) | session ownership through plan→client FOR UPDATE; "unlogged" check; INSERT new groups + exercises, UPDATE old exercises inactive, UPDATE session meta, UPDATE future scheduled events' name/focus/surplus; RETURNS the session with its active exercises |
| `place_library_session_atomic(p_client_id, p_plan_id, p_saved_session_id, p_date, p_today, p_not_before)` | `services/library-placement-service.ts placeSessionOnCalendar` (7 statements, no compensator) | the past-date guard (`p_date >= p_not_before`, closing TECHNICAL-DEBT "place-from-library has no server-side past-date guard"); copy the saved session, groups, exercises; INSERT the training_events row with day_order = max+1; RETURNS the event |
| `pin_client_note(p_client_id, p_note_id, p_pinned)` | 3 statements in `services/client-notes-service.ts` | one UPDATE … `is_pinned = (id = p_note_id AND p_pinned)` over the client's pinned row and the target; RETURNS the note |
| `submit_client_intake(p_client_id)` | 3 statements in `services/client-intake-service.ts submitIntake` | UPDATE client_intake status; UPDATE clients.onboarding_status; RETURNS both |
| `clear_nutrition_plans_atomic(p_client_id, p_today)` | `services/nutrition-plan-clear-service.ts` edits-delete → cap → archive | the three in one transaction (the edits are no longer lost if the cap fails) |
| `create_client_atomic(p_coach_id, p_client jsonb, p_readings jsonb, p_goal jsonb, p_intake boolean)` | `services/client-service.ts createClient` steps 2–9 | INSERT clients; INSERT client_measurements; `add_client_goal` called inside; INSERT client_intake; RETURNS the client row. The invitation (Resend, then the invitations row) stays as the auth plan's D41 built it. |

Two writes become one statement without an RPC: the coach's reply (`updateCheckInResponse` + `markResponseAsSent`
→ one UPDATE setting all five columns) and a new program's seven rest sessions (`createSavedPlanManual` → one
batched insert through the existing `insertSavedSessionRows`).

What stays outside the transaction, by decision: the energy recompute (`recalculateClientEnergy`: idempotent,
never throws, D7); the adherence recompute (one read, never fails the request, D7; moved into SQL in P7b).

### 2.5 Paged histories (P3a)

The Training and Nutrition history tabs show one row per calendar day, newest first, ten at a time. A page is ten
calendar days, so the database reads are bounded by the page, never by the history:
- Page 1: days `today-9 … today`; next page: the ten days before the oldest day shown. The cursor is the oldest day
  shown, opaque through `lib/cursor.ts` (a `date` form beside the existing `{createdAt, id}` form, same strict decode).
- Training: one `training_events` read for the ten days (named columns + the log embed); `training_sessions` names
  only for swaps inside the window. Nutrition: the week reader (§2.6) over the ten days.
- Total = days from the first activity to today: one `min(date)` read (events; for nutrition, the earlier of the
  first log and the first version), cached on the page's first request's response (`total` rides every page as today).
- Rows past PostgREST's cap can no longer be truncated because no read can exceed ten days of rows.

### 2.6 One week reader (P5a, P5b): `services/week-figures-service.ts`

```ts
readWeekFigures(ctx, startDate, endDate): Promise<WeekFigures>
// WeekFigures = { events, nutritionLogs, wellnessLogs, targetsByDay (versions → grids ∥ edits, computed once), habitRange }
```

One pass, two waves (versions, then grids ∥ events ∥ logs ∥ edits ∥ habits), 6–7 calls for any range. Consumers take
`WeekFigures` and become pure: the check-in context's nine branches, the submit's snapshot builder and its adherence
figures, `getDailyLogs`, `getNutritionPeriod`, `getClientAdherenceForRange`, the client's day summary branches, the
client nutrition-plan route's week. After P5a the check-in context is ≤ 12 calls (today 29); the submit's reads ≤ 10
(today ~45).

### 2.7 Narrow reads and exact keys (P3b–P3d, P6a, P6b)

- **Plan metadata.** `getTrainingPlanMetaForDate(ctx, date)` returns the plan row's named columns and a session
  count; `assertPlanOwned(planId, ctx)` is `training_plans select id, client_id`. The Training tab's route returns
  metadata; the seven calendar write routes that load the whole program to read `plan.clientId` use the assertion.
  `?include=sessions` keeps the whole program for the one consumer that renders it (`/client/program/training`).
- **Lists return list columns.** The coach's and the client's check-in lists: id, client_id, status, created_at,
  period_start, period_end, ai_summary, coach_response, response_sent_at, and the client name embed; no snapshots.
  Unreviewed: id, client_id, status, created_at, client name. Saved-plan and saved-session libraries: the row plus
  `coach_saved_sessions(count)` / `coach_saved_exercises(count)`; the builder reads a template or a session by id
  when one is opened or dropped. Roster: `check_ins` embed ordered desc, limit 1 (`referencedTable`).
- **Measurements.** `/measurement-series` returns series + baseline (the Overview's and the Physique pane's reads);
  the log list is its own paged route `/measurements/log?cursor=` (keyset on `recorded_on, recorded_at, id`).
- **`select("*")`** survives only in the allowlist (§2.3 A): rows a screen renders whole.
- **Exact keys.** `invalidateTrainingData`, `invalidateNutritionCalendar` and the other area matchers in
  `hooks/use-calendar-events.ts` and `hooks/use-nutrition-calendar-events.ts`
  become explicit key lists built from the ids the caller knows. A write that returns the new state seeds its key and
  does not refetch it; a key that no mounted component holds is not refetched. `useNutritionPlan` becomes SWR
  (closing TECHNICAL-DEBT "`useNutritionPlan` is not SWR").

### 2.8 Aggregates in SQL (P7a, P7b)

`get_client_progression_pct(p_client_id, p_from, p_to)` (one number: the Overview's progression), `get_pr_deltas_since
(p_client_id, p_anchor timestamptz)` (the Overview feed's PR rows), `compute_check_in_adherence(p_client_id)` (count,
rate, current and longest streak — replacing `services/check-in-adherence-service.ts`'s TS after a proof of equal
results on the scale seed), `get_saved_plans_summary(p_coach_id)` and `count_saved_plan_assignments(p_coach_id)`
(the Programs page's four figures), `get_habit_adherence_for_clients(p_client_ids, p_from, p_to)` (the attention feed's
habit branch). Each SECURITY DEFINER, service_role only, indexed by the predicates it filters on (added with the
function, CONVENTIONS §14).

### 2.9 AI off the request path (P8b)

The check-in AI left with `docs/SUNSET-PLAN.md`; the one AI call left is the builder's assistant.

- **Builder assistant.** `POST /api/training/assistant` streams the tool runner's events as SSE and the dock renders
  them as they arrive (the owner sees the first tokens in seconds, not after up to 30 model calls). The exercise
  catalog it resolves against is held in memory per coach for five minutes (`lib/perf/catalog-cache.ts`), invalidated
  when the coach creates or edits an exercise.

### 2.10 Facts this plan relies on (checked 2026-10-10)

1. `pg-pool` closes an idle client after 10 s by default (`node_modules/pg-pool/index.js:98-99`); `lib/auth.ts:84-89`
   sets no `idleTimeoutMillis`. (Fixed by the auth plan's 10.5.)
2. Better Auth 1.7.7 reads a session as two queries unless `advanced.database.joins` is on
   (`node_modules/@better-auth/core/dist/db/adapter/factory.mjs:191-203`); the plan marks joins experimental (10.5).
3. The proxy (`proxy.ts:103-127`) reads the session and the profile role for every non-public request, including
   `/api/**`; the role is used only for page redirects (`:134-148`). Routes authenticate again
   (`lib/auth-helpers.ts:58-72`). CONVENTIONS §8 names the route as the perimeter.
4. Supabase's PostgREST "Max rows" defaults to 1000; the owner confirms the project's value (Dashboard → Settings →
   API). Code comments assume 1000 (`services/training-service.ts:40-46`).
5. supabase-js supports `.order(col, { referencedTable })` and `.limit(n, { referencedTable })` on an embedded
   resource, and `table(count)` in a select for an embedded count.
6. Vercel's default function region is `iad1` (Washington). Dublin is `dub1`, Frankfurt `fra1`. Hobby plans allow
   one region; `vercel.json` `"regions": ["dub1"]` pins it per deployment.
7. Retired with the sunset (the post-response AI job); the number is kept so later references hold.
8. `scripts/perf-baseline-wrapper.ts` already patches `supabaseAdmin.from` / `.rpc` with an `AsyncLocalStorage`
   context and records table, rows, bytes and ms per call; `scripts/proof-server.ts` starts a `next dev` on a free
   port (never :3000) and keeps its stdout in `output: string[]`.

---

## 3. Decisions

Defaults are set so no commit stops on a blank. The owner may change any before its commit runs.

- **D1 Order and ceremony.** By mechanism, in §6's order. Three tiers (§6 "How every commit runs"): A for the four
  RPC rewrites plus the check-in submit, B for the sweeps, C for config and columns.
- **D2 Budgets.** §2.2's numbers. Recorded per route in `scripts/perf-routes.ts`; enforced from P4c.
- **D3 The counter is dev-only.** `PERF_COUNT=1` in `.env.local` and in the proof server; a production build carries a
  no-op import. Never a header on the response (nothing about the database reaches a browser).
- **D4 `check:perf` is a ratchet.** A baseline file; a commit may add no violation; phases remove them.
- **D5 Region.** `vercel.json` with `"regions": ["dub1"]`. Upstash's primary region must be eu-west-1; if it is not,
  the owner creates a new database there and rotates `UPSTASH_REDIS_REST_URL`/`_TOKEN` (§9).
- **D6 The proxy authenticates pages only.** A request whose path starts with `/api/` passes the proxy untouched
  (before any read); `/api/**` routes are the perimeter, as CONVENTIONS §8 already says and every route already does.
  `PUBLIC_PREFIXES` and the page redirects are unchanged.
- **D7 The submit RPC's edge.** Inside: the check-in row, readings, answers, highlights, the schedule advance. Outside,
  after it: the energy recompute (idempotent, never throws) and the adherence recompute (one read, logs on failure,
  never fails the request — P7b moves it into SQL). The snapshot is still built in TS before the RPC (P5a shrinks its
  reads). A repeat submit for the same period → 409 "already checked in" from the unique index, and now only ever
  against a complete row.
- **D8 The workout RPC keeps today's response.** `POST /api/client/training/events/[eventId]/log` answers the same
  JSON as today (the set tracker seeds from it; the app contract). The edit-window rule (`canEditDay`) stays in TS as a
  gate before the RPC; ownership and status are checked again inside it.
- **D9 The tray RPC's order.** Insert new groups and exercises, deactivate old, update meta and future events, in one
  transaction; a failure anywhere leaves the session as it was.
- **D10 The session-place RPC takes `p_not_before`** (the deletion floor the route computes today) and refuses an
  earlier date, closing the TECHNICAL-DEBT item.
- **D11 The four small seams** are fixed as §2.4's last rows say; the reply becomes one UPDATE.
- **D12 `create_client_atomic`** covers the client, its readings, its goal and its intake row; sending the invitation is
  unchanged (auth plan D41 decided its failure semantics).
- **D13 Histories page by calendar day**, ten per page, cursor = the oldest day shown, total = days since first activity.
- **D14 The client contract changes now, before the app exists** (`CLIENT-APP-REFERENCE.md` is updated in P3d):
  `PATCH /api/client/daily-logs/[date]/nutrition|wellness` answer `{ day }` (the saved row) and read nothing back;
  `GET …/wellness` answers the wellness fields + `editable`; `/api/client/check-ins` rows carry no `periodSnapshot`;
  `/api/client/training-plan` answers plan metadata + a session count, and `?include=sessions` the whole program.
  (`/api/client/goal`, the sunset's rename of the journey route, is already goal-only.)
- **D15 `ClientContext`** as §2.1; after P4c the three resolvers and `getClientById` are route-layer only (rule B at zero).
- **D16 The week reader** as §2.6; consumers are pure functions of `WeekFigures`.
- **D17 Exact keys** as §2.7; a write seeds, never refetches, its own key.
- **D18 Aggregates** as §2.8; `compute_check_in_adherence` replaces the TS only after `scripts/adherence-parity-proof.ts`
  shows equal results for every client of the scale seed.
- **D19 AI** as §2.9: SSE for the assistant and an in-memory catalog. The check-in AI left with the sunset.
- **D20 Migration numbers** are the next free number when the commit runs (`supabase/migrations/README.md`). DEV is at
  215. `docs/COACH-CHAT-PLAN.md` names 216 for its own; whichever plan lands first takes 216 and the other renumbers
  its entry in the same commit.
- **D21 Better Auth's limiter stays on `database`.** `secondary-storage` would also move sessions out of Postgres; the
  cost is two statements per `/api/auth/*` call in production only. Recorded in TECHNICAL-DEBT by P9.
- **D22 The Redis auth cache stays.** An in-process cache would let a deactivated client keep API access for up to
  60 s on another instance; the Redis hop is 2–3 ms co-located.
- **D23 Polls are bounded, not merged.** Overdue, due-soon and unreviewed keep their routes and intervals; each reads
  one row per client or named columns. Merging them is a chrome redesign for later.

---

## 4. Blast radius

- **CONVENTIONS.md.** No rule is broken. P0 adds the six rules to §8/§14 (the request context, one RPC per
  multi-table write named with its gate, the budgets, reads return what the screen renders, paged in the database,
  exact keys), each with its gate marker. P9 marks every OTHER rule in the file as gated (named check) or ungated. P4
  makes §8's "routes authenticate, services use `supabaseAdmin`" literally true for context too.
- **ARCHITECTURE.md** (current shape only, per commit): "Coach-side Data Flow" (the Overview's and the tabs' reads),
  "Client Portal Architecture" (the check-in context, the day summary, the hub), "Auth Model" (the proxy's scope),
  "API Route Structure" (the counter, `ClientContext`, the budgets), "Check-in System" (the submit RPC),
  "Training Completion Hierarchy" (the workout RPC), "Coach Library" (list shapes, the catalog search).
- **TECHNICAL-DEBT.md.** Closes: "`useNutritionPlan` is not SWR" (P6a), "Nutrition-calendar invalidation" (P6a),
  "`place-from-library` has no server-side past-date guard" (P2d), "Deployment prerequisite — assistant route needs a
  >240s function timeout" (P8b, streaming). Adds: D21.
- **CLIENT-APP-REFERENCE.md.** "API Endpoints" and "Data Models" for D14 (P3d).
- **Files most touched.** `lib/require-coach-auth.ts`, `lib/require-client-auth.ts`, `lib/auth-helpers.ts`,
  `services/today-service.ts`, `services/check-in-week-service.ts`, `services/client-service.ts`,
  `services/check-in-service.ts`, `services/training-log-service.ts`, `services/training-session-replace-service.ts`,
  `services/library-placement-service.ts`, `services/training-service.ts`, `services/nutrition-days-service.ts`,
  `services/daily-logs-service.ts`, `services/check-in-context-service.ts`, `hooks/use-calendar-events.ts`,
  `proxy.ts`, and every route under `app/api/clients/[id]/**` and `app/api/client/**`.

---

## 5. Verification

- **Gates, by tier.** Tier A: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`,
  `npm run check:perf`, `npx knip`, `npm run check:service-key`, `npm run check:rls` (a migration), `npm run build`;
  the commit's proof script on DEV; one independent review of the diff, its blockers and should-fix items fixed at the
  root; the §7 smoke, run by the owner. Tier B: the same gates minus `check:rls` unless a migration ships, no review,
  no smoke unless §6 names one; the proof is `perf-count`'s before/after on the routes touched plus every existing
  proof script that covers them (`scripts/*-proof.ts`). Tier C: `tsc`, `eslint`, `vitest`, `check:perf`, `knip`,
  `build`, and `perf-count` on the routes touched. `grep -rn "console.log"`, `"as any"` and `TODO|FIXME|HACK` on
  changed files, every tier. The set-tracker test flake (`components/client-portal/**`): rerun alone and say so.
- **Proofs on DEV** (the shape of `scripts/goal-routes-proof.ts`: `startProofServer`, throwaway logins from
  `scripts/auth-fixtures.ts`, every row deleted in `finally`, never :3000):
  - P2a `scripts/check-in-submit-proof.ts`: a throwaway client with a program, a nutrition version, a habit and a form
    submits with two readings, two answers and a highlight → 201, one check_ins row with both snapshots, two
    client_measurements rows with source_id = the id, two answers, one highlight, `next_check_in_due` advanced; the
    same period again → 409; an answer for a question the coach does not own → 4xx and NO row in any of the five
    tables (the transaction).
  - P2b `scripts/log-training-event-proof.ts`: log a 3×3 workout → 200 in today's shape, one session_logs row, three
    exercise_logs, nine set_logs, the event linked and completed; re-log replaces, never duplicates; a set row that
    violates the UNIQUE (exercise_log_id, set_number) → 4xx and the previous log intact; another client's event → 403/404
    and nothing written.
  - P2c `scripts/replace-session-proof.ts`: edit a placed day's exercises → the old rows inactive, the new active, future
    events renamed, the response equals a fresh GET; a logged session → refused, unchanged; a bad group payload → 4xx,
    unchanged.
  - P2d `scripts/place-session-proof.ts`: drop a library session on a future day → event + session + groups + exercises;
    on a day before the floor → 4xx and no orphan session row (count unchanged).
  - P3a `scripts/history-paging-proof.ts`: a throwaway client with 35 events over 40 days → page 1 has 10 days, three
    cursors walk to day 40 with no overlap or gap, `total` = days since the first event and equal on every page;
    the server printed ≤ 3 `[db]` lines per page.
  - P7b `scripts/adherence-parity-proof.ts`: for every client of `seed-scale`, the TS figures equal the SQL function's.
- **The numbers.** `scripts/perf-count.ts` before and after, in every handover from P1 on. The owner's smokes record
  the `[db-burst]` lines.

---

## 6. The commits

**How every commit runs.** Each prompt is complete on its own; paste it into a fresh session. Where this block and a
prompt disagree, this block wins.
1. **Read** CONVENTIONS.md whole; from this plan its head, §2's subsections the entry cites, §3 (the D-items the entry
   cites), §5 for the tier, this block, and the commit's own entry (and its §7 smoke for Tier A). ARCHITECTURE only
   where the prompt names a section. Nothing else of this plan.
2. **No library fact check.** Nothing here depends on a library's behaviour except §2.10's facts, which the entries
   that use them name; check that one fact against `node_modules` or the dashboard and stop if it is false.
3. **Tests:** a test for every new rule; a mutation only for the rules the prompt names and for any guard inside an
   RPC (ownership, status, the floor). While building, run only the affected test files.
4. **Review:** Tier A only — one independent review of the diff once built; fix blockers and should-fix items at the
   root; list nits in the handover. Tiers B and C: none.
   **Every tier, before the gates — the whole-request review against the rules.** For each route the commit touched,
   follow the request from the route handler through every service to every database call, as the review of
   2026-10-10 did, and check it against the six P0 rules: context resolved once and handed down; one RPC for a
   multi-table write; within budget; selects name what the screen reads; paged in the database; exact keys. The
   handover lists each route with the six marks (✓ or the file:line that breaks the rule and why it is left). A
   rule broken by code this commit wrote is fixed before the gates run; one broken by code it did not touch is a
   mark in the handover for the commit that owns it.
5. **Proof and gates:** the entry's proof once on the finished code; the tier's gates once after the last fix.
   `perf-count` before the change and after it, for the routes the entry names.
6. **Scope:** build what the entry lists. A fact that changes how a later commit must be built goes into that
   commit's entry here; anything else worth doing goes in the handover as a recommendation.
7. **Context:** `PERF_COUNT=1` is set in `.env.local` from P0 on. `lsof -i :3000` first: the proof server starts its
   own `next dev` on a free port, never :3000, and none runs while another `next dev` holds this folder.
8. **Migrations:** `npx supabase db push --dry-run --linked` first, then the push, once, on DEV; `check:rls` after.
   PROD is §8, not the commit.
9. **Commit directly to main** (this plan file included), replace the entry's STATUS with SHIPPED, the hash and the
   date, and hand over in plain words: what changed, the `perf-count` rows before and after, and anything decided that
   the plan did not say.

**The week** (owner's pace, 12–14 h days, sessions serial because every Tier A commit carries a migration):

| Day | Commits | Owner's smokes |
|---|---|---|
| 0 | **P0 first** (the rules, the counter, the gate), then auth plan 10.5, then `docs/SUNSET-PLAN.md` S1–S3 | the sunset's §7.1 and §7.2 |
| 1 | P1 (re-baselines first; deploy the first preview after it), start P2a | — |
| 2 | P2a, P2b | §7.1, §7.2 |
| 3 | P2c, P2d, P2e | §7.3, §7.4 |
| 4 | P2f, P3a, P3b, P3c, P3d | §7.5 — the app can start after this day |
| 5 | P4a, P4b, P4c | — |
| 6 | P5a, P5b, P6a, P6b | §7.6 |
| 7 | P7a, P7b, P8b, P9 | — |
| 8 | P10, then the compute, Upstash and Vercel sizing from its numbers (§9) | — |

---

### P0 — `perf(rules): CONVENTIONS carries the request rules and budgets; every request logs its database calls; check:perf ratchets` · Tier C

**STATUS: PLANNED 2026-10-10.** **Commit zero of everything** — before `docs/SUNSET-PLAN.md` S1 and before any
other commit here (owner, 2026-10-10: "Put the new rules in first… otherwise 25 fast commits will drift back toward
the old patterns, especially in the code written late in the week"). Every later session reads CONVENTIONS whole, so
the rules below are in force for every line written after this commit, and the gate refuses a commit that adds a
violation from this commit on.

- **CONVENTIONS.md additions, written as rules, not as plans.** Under §8 (Shape B): *the route resolves the request's
  client once — its row, today and the week anchor — through the auth helper, and hands that context to every service
  it calls; a service never resolves it for a client it was handed* (§2.1 — the type and the helpers arrive in P4a,
  the rule binds now: new code takes what the route has). Under §8 "Multi-table writes are atomic": its gate is the
  Tier A review, named as such. Under §14: the budgets table (§2.2) with the sentence *a route over budget does not
  ship*; *a read returns what the screen renders — no `select("*")` in a service unless the row is returned whole, and
  then it is allowlisted with a reason*; *anything that can exceed one page is paged in the database; never read whole
  and sliced*; *invalidate by exact key, never by prefix; a write that returns the new state seeds its key and does not
  refetch it*. Each new rule ends with its gate marker: `[gate: check:perf B]`, `[gate: review]`, `[gate: check:perf E]`,
  `[gate: check:perf A]`, `[gate: check:perf C]`, `[gate: check:perf D]`.
- `lib/perf/db-calls.ts` as §2.3: the patch moves out of `scripts/perf-baseline-wrapper.ts` (which imports it); `[db]`
  lines and the `[db-burst]` summary; a no-op when `PERF_COUNT` is unset (a test proves the production path imports
  nothing that touches `supabaseAdmin`). `authPool.query` counted as `[db] pg`.
- `scripts/perf-routes.ts`: one row per route in §6's entries (every route under `app/api/clients/[id]/**`,
  `app/api/client/**`, `app/api/check-in/**`, `app/api/check-ins/**`, `app/api/clients`, `app/api/training/**`,
  `app/api/content/**`), role, the perf fixtures' ids, the §2.2 budget, baseline 0 until `--write`.
- `scripts/perf-count.ts` as §2.3, with `--enforce` and `--write`; run `--write` once so every row carries today's count
  (the plan's "before" numbers; paste the table into this entry's handover).
- `scripts/check-perf.ts`, `npm run check:perf`, rules A–D as ratchets from this commit with
  `scripts/check-perf-baseline.json` written by `--write` (a later commit may not add a violation; P4c and P6a take B
  and D to zero); `scripts/check-perf-allowlist.ts` starts empty.
- Docs: ARCHITECTURE "API Route Structure": one paragraph on the counter and where the budgets live.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.1, §2.2,
§2.3, §2.10 #8, D2–D4, §5 (Tier C) and §6 "How every commit runs" and this
entry. From docs/ARCHITECTURE.md read "API Route Structure". Read
scripts/perf-baseline-wrapper.ts, scripts/perf-baseline.ts,
scripts/perf-fixtures.ts, scripts/proof-server.ts, scripts/proof-session.ts,
scripts/auth-fixtures.ts, scripts/check-labels.ts (the shape of a check
script), services/supabase-admin.ts, lib/auth.ts and package.json.

Job: commit P0 of docs/PERF-PLAN.md §6 — `perf(rules): CONVENTIONS carries the
request rules and budgets; every request logs its database calls; check:perf
ratchets`. Build exactly what the entry lists, to §2.1–§2.3 and D2–D4. The
CONVENTIONS additions are written in the file's own voice as rules in force
now, each with its gate marker; nothing in them says "will" or names a commit.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the six rules are in CONVENTIONS.md with their gate markers and read
as rules; `PERF_COUNT=1 npx tsx scripts/perf-count.ts --write` has run against
the proof server and every row of scripts/perf-routes.ts carries a measured count;
`npm run check:perf --write` has written the baseline and `npm run check:perf`
passes; a test proves lib/perf/db-calls.ts is a no-op without PERF_COUNT; the
baseline harness still runs; and the Tier C gates pass: npx tsc --noEmit, npx
eslint ., npx vitest run, npm run check:labels, npm run check:perf, npx knip,
npm run build. lsof -i :3000 first; the proof server never uses :3000.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over in plain words: the
six rules as written, the perf-count table (every route, calls, serial, ms,
bytes), the check:perf violation counts per rule, and anything you decided that
the plan did not say.
```

After the sunset (S1–S3) lands, `perf-count --write` and `check:perf --write` are re-run once so the baselines cover
only surviving routes — the first step of P1's prompt.

### P1 — `perf(auth): the proxy leaves API routes to their own authentication; the region is pinned; the dashboard's polls stop growing` · Tier C

**STATUS: PLANNED 2026-10-10.** After the auth plan's commit 10.5.

- `proxy.ts`: a request whose pathname starts with `/api/` is passed through before any read (D6, §2.10 #3). A test:
  `/api/clients` with no cookie reaches the route (which answers 401 itself, as today); `/dashboard` with no cookie
  still → 307 `/login`; a client on `/dashboard` still → `/client`.
- `vercel.json` with `"regions": ["dub1"]` (D5, §2.10 #6).
- `services/client-service.ts getClientsForCoach`: the `check_ins` embed ordered `created_at desc`, `limit 1`
  (`referencedTable`, §2.10 #5); the JS "latest" pick becomes a read of the one embedded row. Used by `/api/clients`,
  `/api/clients/overdue`, `/api/clients/due-soon`.
- `app/api/check-ins/unreviewed/route.ts`: named columns (id, client_id, status, created_at, client name); its mapper
  variant; the dropped `clients` error is returned as 500, not an empty 200.
- `lib/rate-limit.ts`: the coach tier stops punishing a shared address. `coachApiRateLimit` (per IP) becomes a coarse
  guard (300 per 10 s) and a new per-coach limiter (30 per 10 s, keyed by coach id) runs inside `requireCoachAuth` /
  `requireCoachOwnsClient` once the id is known — the shape the client side already has (`requireClientAuth`'s
  per-client limiter). Each tier gets its own prefix (closing the TECHNICAL-DEBT key-sharing item), `analytics: false`,
  and the `Ratelimit` instances are module-scope, not per request. A test: two coaches behind one IP do not share the
  30-per-10-s budget (with a mutation).
- Docs: ARCHITECTURE "Auth Model" (the proxy's scope: pages; the two coach limiters), "Coach-side Data Flow" (the
  three polls' reads).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.10 #3, #5,
#6, D5, D6, D23, §5 (Tier C), §6 "How every commit runs" and this entry. From
docs/ARCHITECTURE.md read "Auth Model" and "Coach-side Data Flow". Read proxy.ts,
proxy.test.ts if present, lib/auth-helpers.ts, lib/rate-limit.ts and its test,
lib/require-coach-auth.ts, lib/require-client-auth.ts (the per-client limiter's
shape), the TECHNICAL-DEBT.md entry on the limiter's shared prefix,
services/client-service.ts, app/api/clients/route.ts,
app/api/clients/overdue/route.ts, app/api/clients/due-soon/route.ts,
app/api/check-ins/unreviewed/route.ts, lib/mappers.ts and
hooks/use-check-in-data.ts. Check §2.10 #5 against
node_modules/@supabase/postgrest-js before relying on it.

Job: commit P1 of docs/PERF-PLAN.md §6 — `perf(auth): the proxy leaves API routes
to their own authentication; the region is pinned; the dashboard's polls stop
growing`. First, because the sunset landed after P0: run
`PERF_COUNT=1 npx tsx scripts/perf-count.ts --write` and `npm run check:perf
--write` so the baselines cover only the routes that survive, and drop the
deleted routes from scripts/perf-routes.ts. Then build exactly what the entry
lists, to D5, D6 and D23.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the proxy tests and the limiter test named in the entry pass, each
with a mutation; scripts/sign-in-proof.ts still passes on DEV; perf-count before
and after for /api/clients, /api/clients/overdue, /api/clients/due-soon and
/api/check-ins/unreviewed shows one database call each and `[db] pg` lines gone
from every /api/** request; and the Tier C gates pass: npx tsc --noEmit, npx
eslint ., npx vitest run, npm run check:labels, npm run check:perf, npx knip,
npm run build. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over in plain words: what
changed, the perf-count rows before and after, and anything you decided that the
plan did not say.
```

### P2a — `feat(check-in): a client's check-in is one transaction: submit_check_in_atomic` · Tier A

**STATUS: PLANNED 2026-10-10.**

- Migration (next free number, D20): `submit_check_in_atomic` as §2.4, with the standing-read "unchanged" rule for
  readings expressed in SQL (the same rule `appendMeasurements` applies), `REVOKE`/`GRANT` per §8.
- `services/check-in-service.ts submitCheckIn`: builds the two snapshots as today (reads untouched here — P5a), then
  one `.rpc("submit_check_in_atomic", …)`; then `recalculateClientEnergy` (unchanged, idempotent) and the adherence
  recompute reduced to one `check_ins select created_at` read and never thrown (D7); the AI job wrapped in `after()`
  from `next/server` (D19, §2.10 #7). `insertCheckInAnswers`, `insertExerciseHighlights`, the `clients` update and the
  measurement calls inside the old path are deleted.
- `app/api/client/check-ins/route.ts`: the client is read once (`getClientById` stays until P4b), the form read runs
  in parallel with it; photo uploads run in parallel (`Promise.all`); the response is unchanged.
- Tests: the RPC's guards (ownership, the period-unique, foreign question id) with mutations; the route's parallel
  reads; `after()` used (a unit test asserting the call shape).
- Proof §5 P2a; smoke §7.1. Docs: ARCHITECTURE "Check-in System" (the submit as one transaction, the AI job after the
  response).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.4, §2.10 #7,
D7, D19, D20, §5 (Tier A and the P2a proof), §6 "How every commit runs", this
entry and §7.1. From docs/ARCHITECTURE.md read "Check-in System". Read
app/api/client/check-ins/route.ts, services/check-in-service.ts,
services/check-in-sent-snapshot-service.ts, services/check-in-details-service.ts,
services/measurements-service.ts (appendMeasurements and its standing read),
services/client-energy-service.ts, services/check-in-adherence-service.ts,
supabase/migrations/156_*.sql (the period-unique index), supabase/migrations/157_check_in_forms.sql
(the shape of a SECURITY DEFINER function here), supabase/migrations/README.md,
scripts/goal-routes-proof.ts and scripts/check-in-sent-snapshot-proof.ts (proof
shapes), and lib/require-client-auth.ts.

Job: commit P2a of docs/PERF-PLAN.md §6 — `feat(check-in): a client's check-in is
one transaction: submit_check_in_atomic`. Build exactly what the entry lists, to
§2.4 and D7. The migration takes the next free number (D20).

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/check-in-submit-proof.ts passes on DEV; every guard inside
the function has a test and a mutation; one independent review of the diff has
run and its blockers and should-fix items are fixed at the root; perf-count
before and after for POST /api/client/check-ins shows the write as one rpc line
and the statement count in the handover; and the Tier A gates pass: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npm run
check:perf, npx knip, npm run check:service-key, npm run check:rls, npm run
build. Migration: --dry-run first, then push to DEV once. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over in plain words: what
changed, the statement counts before and after, the review's nits, the §7.1
smoke's seed (you seed it; I run the smoke), and anything you decided that the
plan did not say.
```

### P2b — `feat(training): logging a workout is one transaction: log_training_event_atomic` · Tier A

**STATUS: PLANNED 2026-10-10.**

- Migration: `log_training_event_atomic` as §2.4 and D8; the session snapshot (today `writeSessionLog`'s +39 read and
  the prescription it stores) as an `INSERT … SELECT` inside the function; group scores replaced inside; the event
  linked inside. Returns the saved log in the exact shape `POST /api/client/training/events/[eventId]/log` answers
  today (compare against the route's current response type).
- `services/training-log-service.ts`: `writeSessionLog`'s statements replaced by one rpc; the edit-window gate
  (`canEditDay` through `getDayEditState`) stays before it; `clear_training_event_log` unchanged.
- `app/api/client/training/events/[eventId]/log/route.ts`: unchanged response; one read fewer where the ownership read
  duplicates the RPC's check.
- Tests: guards with mutations (another client's event; a non-scheduled event's status rule as today; the UNIQUE on
  set rows); a response-shape test against a recorded fixture.
- Proof §5 P2b; smoke §7.2. Docs: ARCHITECTURE "Training Completion Hierarchy" (the write as one transaction).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.4, D8, D20,
§5 (Tier A and the P2b proof), §6 "How every commit runs", this entry and §7.2.
From docs/ARCHITECTURE.md read "Training Completion Hierarchy". Read
app/api/client/training/events/[eventId]/log/route.ts,
services/training-log-service.ts (whole), services/training-log-group-scores.ts,
services/daily-log-permissions-service.ts, components/client-portal/training/set-tracker.tsx
(what it seeds from the response), supabase/migrations/*clear_training_event_log*
(the sibling function), supabase/migrations/README.md, scripts/clear-training-log-proof.ts
and scripts/goal-routes-proof.ts.

Job: commit P2b of docs/PERF-PLAN.md §6 — `feat(training): logging a workout is
one transaction: log_training_event_atomic`. Build exactly what the entry lists,
to §2.4 and D8; the response JSON does not change by one key.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/log-training-event-proof.ts passes on DEV; every guard has a
test and a mutation; the response-shape test passes against the recorded fixture;
one independent review of the diff has run and its findings are fixed at the
root; perf-count before and after for the log route shows one rpc line; and the
Tier A gates pass (the list in P2a). Migration: --dry-run, then push to DEV once.
The set-tracker test is known to flake in full runs: if it alone fails, rerun it
alone and say so. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
statement counts before and after, the review's nits, the §7.2 seed, and anything
you decided that the plan did not say.
```

### P2c — `feat(training): the coach's per-day session edit is one transaction: replace_training_session_atomic` · Tier A

**STATUS: PLANNED 2026-10-10.**

- Migration: `replace_training_session_atomic` as §2.4 and D9; the "unlogged" rule (`assertSessionUnlogged`) inside;
  future events' name/focus and surplus updates inside; returns the session with its active exercises in the GET's shape.
- `services/training-session-replace-service.ts` and `services/training-session-service.ts bulkReplaceExercises`: the
  statements replaced by one rpc; `resolveMissingExerciseIds` (freehand names → catalog ids) stays before the RPC and
  reads only the names given (`.in("name", …)` case-insensitive through a small SQL function `resolve_exercise_names
  (p_coach_id, p_names text[])` in the same migration), never the whole catalog.
- `app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts` PUT: `getTrainingPlanById` (the whole
  program) replaced by a `training_plans select id, client_id` assertion (the first use of §2.7's `assertPlanOwned`,
  placed in `services/training-service.ts`).
- Browser: `components/clients/training/calendar/use-placed-session-editor.ts` seeds the response and no longer
  refetches its own key (D17's first instance; the area invalidation of `/training` and `/events` stays until P6a).
- Tests, proof §5 P2c, smoke §7.3. Docs: ARCHITECTURE "Coach-side Data Flow" (the tray save).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.4, §2.7
(plan metadata), D9, D17, D20, §5 (Tier A and the P2c proof), §6 "How every
commit runs", this entry and §7.3. From docs/ARCHITECTURE.md read "Coach-side
Data Flow". Read app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.ts,
services/training-session-replace-service.ts, services/training-session-service.ts,
services/training-session-lock.ts, services/training-group-writes.ts,
services/exercise-catalog-service.ts (resolveExercises, fetchCatalogRowsForResolve),
services/training-service.ts (getTrainingPlanById), components/clients/training/calendar/use-placed-session-editor.ts,
hooks/use-calendar-events.ts, supabase/migrations/180_building_programs_several_sessions_a_day.sql
(edit_training_plan_atomic, the sibling), supabase/migrations/README.md and
scripts/goal-routes-proof.ts.

Job: commit P2c of docs/PERF-PLAN.md §6 — `feat(training): the coach's per-day
session edit is one transaction: replace_training_session_atomic`. Build exactly
what the entry lists, to §2.4 and D9.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/replace-session-proof.ts passes on DEV; every guard has a test
and a mutation; one independent review of the diff has run and its findings are
fixed at the root; perf-count before and after for the PUT shows ≤ 3 reads + 1
rpc; and the Tier A gates pass (the list in P2a). Migration: --dry-run, then push
to DEV once. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, the review's nits, the §7.3 seed, and anything you
decided that the plan did not say.
```

### P2d — `feat(training): placing a library session is one transaction, and never before the floor: place_library_session_atomic` · Tier A

**STATUS: PLANNED 2026-10-10.**

- Migration: `place_library_session_atomic` as §2.4 and D10.
- `services/library-placement-service.ts placeSessionOnCalendar`: one rpc; the route's `refuseStartBeforeFloor` result is
  the `p_not_before` it passes. `app/api/clients/[id]/training/place-from-library/route.ts` (session branch): the
  whole-program read replaced by `assertPlanOwned`.
- TECHNICAL-DEBT: the "`place-from-library` has no server-side past-date guard" entry is removed (the file records
  current debt only).
- Tests, proof §5 P2d, smoke §7.4. Docs: ARCHITECTURE "Coach Library" (placing a session).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.4, D10, D20,
§5 (Tier A and the P2d proof), §6 "How every commit runs", this entry and §7.4.
From docs/ARCHITECTURE.md read "Coach Library". Read
app/api/clients/[id]/training/place-from-library/route.ts,
services/library-placement-service.ts (whole), services/event-deletion-floor.ts,
services/training-service.ts (assertPlanOwned from P2c), the TECHNICAL-DEBT.md
entry named in this commit, supabase/migrations/168_placement_rpc_writes_the_window.sql
(create_training_plan_atomic, the sibling), supabase/migrations/README.md and
scripts/goal-routes-proof.ts.

Job: commit P2d of docs/PERF-PLAN.md §6 — `feat(training): placing a library
session is one transaction, and never before the floor:
place_library_session_atomic`. Build exactly what the entry lists, to §2.4 and D10.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/place-session-proof.ts passes on DEV (including the
before-the-floor refusal leaving no orphan row); every guard has a test and a
mutation; one independent review has run and its findings are fixed at the root;
perf-count before and after for the route's session branch; and the Tier A gates
pass (the list in P2a). Migration: --dry-run, then push to DEV once. lsof -i :3000.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts, the review's nits, the §7.4 seed, and anything you decided that the plan
did not say.
```

### P2e — `fix(writes): four small saves stop half-saving: the pinned note, the coach's reply, the intake's finish, the nutrition plan's removal` · Tier B

**STATUS: PLANNED 2026-10-10.**

- Migration: `pin_client_note`, `submit_client_intake`, `clear_nutrition_plans_atomic` as §2.4 (D11).
- `services/client-notes-service.ts` pin → the rpc; `app/api/check-in/[id]/review/route.ts` + `services/check-in-service.ts`:
  `updateCheckInResponse` and `markResponseAsSent` become one UPDATE of all five columns;
  `services/client-intake-service.ts submitIntake` → the rpc (the unchecked `clients` update error is gone with it);
  `services/nutrition-plan-clear-service.ts clearNutritionPlansForClient` → the rpc; its two callers unchanged.
- Tests for each guard; the existing proofs that cover these routes (`scripts/*-proof.ts`, grep for the routes) still pass.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.4 (the last
four rows and the paragraph under the table), D11, D20, §5 (Tier B), §6 "How
every commit runs" and this entry. Read services/client-notes-service.ts,
app/api/clients/[id]/notes/[noteId]/route.ts, app/api/check-in/[id]/review/route.ts,
services/check-in-service.ts (updateCheckInResponse, markResponseAsSent),
services/client-intake-service.ts, app/api/client/intake/submit/route.ts,
services/nutrition-plan-clear-service.ts and its callers (grep
clearNutritionPlansForClient), supabase/migrations/README.md and one recent
SECURITY DEFINER migration for the shape.

Job: commit P2e of docs/PERF-PLAN.md §6 — `fix(writes): four small saves stop
half-saving: the pinned note, the coach's reply, the intake's finish, the
nutrition plan's removal`. Build exactly what the entry lists, to D11.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: each guard has a test and a mutation; every existing proof script that
covers these routes passes on DEV; perf-count before and after for the four
routes; and the Tier B gates pass: npx tsc --noEmit, npx eslint ., npx vitest
run, npm run check:labels, npm run check:perf, npx knip, npm run
check:service-key, npm run check:rls, npm run build. Migration: --dry-run, then
push to DEV once. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, and anything you decided that the plan did not say.
```

### P2f — `fix(library): a new program is one insert; a new client is one transaction` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `services/coach-saved-plan-service.ts createSavedPlanManual`: the per-session insert loop becomes one
  `insertSavedSessionRows` call (the overwrite path's helper) inside the same compensation (delete the plan on failure).
- Migration: `create_client_atomic` as §2.4 and D12; `services/client-service.ts createClient` steps 2–9 become one rpc,
  then `sendInvitation` exactly as today.
- Tests; `scripts/invitation-proof.ts` and `scripts/create-coach-proof.ts` still pass; a new program's eight round trips
  become two in `perf-count`.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.4 (the
create_client_atomic row and the paragraph under the table), D12, D20, §5 (Tier
B), §6 "How every commit runs" and this entry. Read
services/coach-saved-plan-service.ts (createSavedPlanManual, overwriteSavedPlan,
insertSavedSessionRows in services/coach-library-helpers.ts),
app/api/training/saved-plans/route.ts, services/client-service.ts (createClient),
app/api/clients/route.ts, services/measurements-service.ts (appendMeasurements),
services/client-intake-service.ts (createIntake), services/invitation-service.ts,
supabase/migrations/193_goals_one_row_per_goal.sql (add_client_goal, called from
inside), supabase/migrations/README.md, scripts/invitation-proof.ts.

Job: commit P2f of docs/PERF-PLAN.md §6 — `fix(library): a new program is one
insert; a new client is one transaction`. Build exactly what the entry lists, to
D12. The invitation's sending and its failure semantics do not change.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: each guard has a test and a mutation; scripts/invitation-proof.ts
passes on DEV; perf-count before and after for POST /api/training/saved-plans
and POST /api/clients; and the Tier B gates pass (the list in P2e, with
check:rls). Migration: --dry-run, then push to DEV once. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, and anything you decided that the plan did not say.
```

### P3a — `perf(history): the Training and Nutrition history tabs read one page from the database` · Tier B

**STATUS: PLANNED 2026-10-10.** A correctness fix: past PostgREST's cap both tabs return wrong rows and a wrong total.

- `lib/cursor.ts`: a `date` cursor form beside `{createdAt, id}`, same strict decode and 400 on malformed.
- `app/api/clients/[id]/history/training/route.ts` and `…/history/nutrition/route.ts` as §2.5 (D13): ten calendar days per
  page, the cursor the oldest day shown, `total` from one `min(date)` read; the whole-history reads, `generateDateRange`
  over the history and the in-memory `slice` are gone. `hooks/use-history-data.ts` and the two tables
  (`components/clients/training/training-history-table.tsx`, `components/clients/nutrition/nutrition-history-table.tsx`)
  page on the cursor (the "offset" param goes). Nutrition's ten days read through `getNutritionTargetsForDateRange`
  bounded to the window (the week reader arrives in P5a).
- Proof §5 P3a; smoke §7.5.

```text
Read CONVENTIONS.md (whole, and again its keyset rules in §8) and from
docs/PERF-PLAN.md its head, §2.5, D13, §5 (Tier B and the P3a proof), §6 "How
every commit runs", this entry and §7.5. From docs/ARCHITECTURE.md read
"Coach-side Data Flow". Read lib/cursor.ts and lib/cursor.test.ts,
app/api/clients/[id]/history/training/route.ts, app/api/clients/[id]/history/nutrition/route.ts,
app/api/clients/[id]/check-ins/route.ts (the keyset pattern already in use),
services/training-event-service.ts (getEventsForDateRange),
services/schedule-data-service.ts, services/nutrition-days-service.ts,
hooks/use-history-data.ts, components/clients/training/training-history-table.tsx,
components/clients/nutrition/nutrition-history-table.tsx, lib/api-utils.ts,
scripts/goal-routes-proof.ts.

Job: commit P3a of docs/PERF-PLAN.md §6 — `perf(history): the Training and
Nutrition history tabs read one page from the database`. Build exactly what the
entry lists, to §2.5 and D13.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/history-paging-proof.ts passes on DEV; the cursor's decode
has a test and a mutation; perf-count before and after for both routes shows
≤ 3 calls per page; check:perf rule C's count fell by these two routes; and the
Tier B gates pass (the list in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, the §7.5 seed, and anything you decided that the plan
did not say.
```

### P3b — `perf(reads): the series, the roster, the journey and the check-in lists stop shipping whole histories` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `app/api/clients/[id]/measurement-series/route.ts`: series + baseline only; the log list moves to
  `app/api/clients/[id]/measurements/log/route.ts`, keyset on `(recorded_on, recorded_at, id)`, 50 per page;
  `components/clients/metrics/measurement-log-section.tsx` pages on the server (its client-side pager goes);
  `hooks/use-merged-metrics.ts` reads the two routes. The range filter (30/60/90/all) stays in the browser over the
  series (bounded points) — or moves to a `?from=` on the series route if the series exceeds 50 kB on the perf fixture.
- `services/client-journey-service.ts`: `fetchWeightSeries` and `currentWeightKg` removed (D14; nothing renders it).
- Check-in lists (`services/check-in-service.ts getClientCheckIns` and the coach list, `lib/mappers.ts`): the §2.7 list
  columns; `periodSnapshot` leaves the client list (D14); `count: "exact"` on page 1 only, as today.
- `app/api/clients/[id]/history/wellness/route.ts`: the count read once (page 1), not per page flip.
- `scripts/check-perf-allowlist.ts` gains nothing here; rule A's count falls.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.7 (lists and
measurements), D14, §5 (Tier B), §6 "How every commit runs" and this entry. From
docs/ARCHITECTURE.md read "Client Goals & Body Metrics" and "Coach-side Data Flow".
Read app/api/clients/[id]/measurement-series/route.ts, services/measurement-series-service.ts,
services/measurements-service.ts (getMeasurementSeries, getMeasurementReadings),
hooks/use-measurement-series.ts, hooks/use-merged-metrics.ts,
components/clients/metrics/measurement-log-section.tsx,
services/client-journey-service.ts, app/api/client/journey/route.ts,
services/check-in-service.ts (both list readers), lib/mappers.ts,
app/api/clients/[id]/check-ins/route.ts, app/api/client/check-ins/route.ts,
components/client-portal/check-in/check-in-card.tsx, components/clients/check-ins/check-ins-tab-content.tsx,
app/api/clients/[id]/history/wellness/route.ts, lib/cursor.ts.

Job: commit P3b of docs/PERF-PLAN.md §6 — `perf(reads): the series, the roster,
the journey and the check-in lists stop shipping whole histories`. Build exactly
what the entry lists, to §2.7 and D14.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the new log route's cursor has a test and a mutation;
scripts/measurement-*-proof.ts and scripts/wellness-series-proof.ts pass on DEV;
perf-count before and after for the routes touched, with body bytes; and the
Tier B gates pass (the list in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts and bytes before and after, and anything you decided that the plan did
not say.
```

### P3c — `perf(library): the program and session libraries list without their exercises; the catalog is searched on the server` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `GET /api/training/saved-plans` (the unpaged list used by the tray and the calendar's apply dialog) and
  `GET /api/training/saved-sessions`: the row plus `coach_saved_sessions(count)` / `coach_saved_exercises(count)`
  (§2.10 #5), no nested exercises; the builder's library panel reads a session by id on drop or open
  (`GET /api/training/saved-sessions/[id]`, added if absent); the client editor keeps reading its template by id.
- `GET /api/training/exercises?q=&limit=50`: server search (name and aliases, case-insensitive, coach's then global)
  through `resolve_exercise_names`'s sibling `search_exercises(p_coach_id, p_q, p_limit)` or an indexed `ilike`; the
  picker (`components/clients/training/program-builder/exercise-picker.tsx`, `hooks/use-exercise-search.ts`,
  `hooks/use-exercise-catalog.ts`) debounces and queries; the whole-catalog download goes. `fetchCatalogRowsForResolve`'s
  callers use `resolve_exercise_names` from P2c (whole-catalog reads on save and on every assistant turn end here;
  the assistant's in-memory cache is P8b).
- `scripts/perf-routes.ts` rows for the three routes get their new counts.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.7 (lists),
§2.10 #5, §5 (Tier B), §6 "How every commit runs" and this entry. From
docs/ARCHITECTURE.md read "Coach Library" and "Exercise Catalog". Read
app/api/training/saved-plans/route.ts, services/coach-saved-plan-service.ts
(getSavedPlans, getSavedPlanById), app/api/training/saved-sessions/route.ts and
its [id] route if present, services/coach-standalone-session-service.ts,
app/api/training/exercises/route.ts, services/exercise-catalog-service.ts,
lib/exercise-search.ts, hooks/use-exercise-search.ts, hooks/use-exercise-catalog.ts,
hooks/use-saved-plans.ts, hooks/use-standalone-sessions.ts,
components/clients/training/program-builder/exercise-picker.tsx,
components/clients/training/program-builder/library-session-list.tsx,
components/clients/training/program-builder/add-exercise-popover.tsx,
components/clients/training/calendar/library-panel.tsx and
training-plan-builder-overlay.tsx (what the tray renders), services/assistant/draft-workspace.ts.

Job: commit P3c of docs/PERF-PLAN.md §6 — `perf(library): the program and
session libraries list without their exercises; the catalog is searched on the
server`. Build exactly what the entry lists, to §2.7.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the search's query has a test (and a mutation for its coach scoping);
perf-count before and after for the three routes with body bytes; the builder's
drop and the tray's apply still work in the existing component tests; and the
Tier B gates pass (the list in P2e; check:rls if a function ships). lsof -i :3000.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts and bytes before and after, and anything you decided that the plan did
not say.
```

### P3d — `feat(client-api): the client routes answer the shapes the app will read` · Tier C

**STATUS: PLANNED 2026-10-10.** After this commit the `/api/client/**` contract is frozen for the app; P4–P9 change no
response.

- D14, every item: the nutrition and wellness PATCH answer `{ day }` and read nothing back (the plan-context lookup and
  the 6-call read-back in `services/daily-log-card-service.ts` and `services/daily-context-service.ts
  resolvePlanContextForDate` go; its only caller was this route); `GET …/wellness` answers wellness + `editable` (the
  nutrition and day-reader calls go); `/api/client/training-plan` answers metadata + session count, `?include=sessions`
  the program; the two pages (`app/client/nutrition/page.tsx`, `app/client/wellness/page.tsx`) and the hub
  (`components/client-portal/program/training-plan-card.tsx`, `app/client/program/training/page.tsx`) follow.
- `CLIENT-APP-REFERENCE.md` "API Endpoints" and "Data Models" updated to the shapes as they are.
- Omitted-field semantics: the nutrition PATCH writes NULL for a field the body omits (`daily-log-card-service.ts`);
  the page sends all four fields, so nothing changes today, but the reference says so plainly.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.7, D14, §5
(Tier C), §6 "How every commit runs" and this entry. Read CLIENT-APP-REFERENCE.md
"API Endpoints" and "Data Models". Read app/api/client/daily-logs/[date]/nutrition/route.ts,
app/api/client/daily-logs/[date]/wellness/route.ts, services/daily-log-card-service.ts,
services/daily-context-service.ts, services/daily-logs-service.ts (getTodayLog),
app/client/nutrition/page.tsx, app/client/wellness/page.tsx,
app/api/client/training-plan/route.ts, services/client-training-plan-service.ts,
app/client/program/page.tsx, app/client/program/training/page.tsx,
components/client-portal/program/training-plan-card.tsx, hooks/use-visit-read.ts,
scripts/wire-proof-day-form.ts and scripts/wire-proof-wellness.ts.

Job: commit P3d of docs/PERF-PLAN.md §6 — `feat(client-api): the client routes
answer the shapes the app will read`. Build exactly what the entry lists, to D14,
and make CLIENT-APP-REFERENCE.md say what the routes now answer.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the wire proofs for the day form and wellness pass on DEV against the
new shapes; perf-count before and after for the four routes; and the Tier C
gates pass (the list in P0). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, and anything you decided that the plan did not say.
```

### P4a — `refactor(routes): a request resolves its client once: ClientContext, and the client-page routes take it` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `lib/client-context.ts` as §2.1 (D15): the type, `loadClientContext(clientId)` (one narrow read with the coach
  timezone embed), and pure `todayFor(row)` / `weekAnchorFor(row)` extracted from `services/today-service.ts` and
  `services/check-in-week-service.ts` (their SQL-reading exports stay for now, marked deprecated).
- `lib/require-coach-auth.ts requireCoachOwnsClient` returns `{ coachId, ctx }`; its callers under
  `app/api/clients/[id]/**` pass `ctx` (or `ctx.today`, `ctx.weekAnchor`) into the services they call; those services'
  signatures take `ctx` and drop their own `getClientById` / today / anchor reads. `GET /api/clients/[id]` keeps the full
  row (the one response that is the whole client) and reads it once, not twice.
- `scripts/perf-routes.ts` rows for every route under `app/api/clients/[id]/**` re-measured.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.1, D15, §5
(Tier B), §6 "How every commit runs" and this entry. From docs/ARCHITECTURE.md
read "API Route Structure" and "Coach-side Data Flow". Read lib/require-coach-auth.ts,
lib/auth-helpers.ts, services/today-service.ts, services/check-in-week-service.ts,
services/client-service.ts (getClientById, CLIENT_SELECT), app/api/clients/[id]/route.ts,
then every route under app/api/clients/[id]/** and each service they call that
imports getClientById, getClientTodayString, getCoachTodayString or
getClientWeekAnchor (grep them). Read scripts/check-perf.ts (rule B's report).

Job: commit P4a of docs/PERF-PLAN.md §6 — `refactor(routes): a request resolves
its client once: ClientContext, and the client-page routes take it`. Build
exactly what the entry lists, to §2.1 and D15. Routes' responses do not change.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: loadClientContext, todayFor and weekAnchorFor have tests (todayFor and
weekAnchorFor against the cases the two services' tests already hold);
check:perf rule B's count fell by every service this commit converted; every
existing proof script under scripts/ that targets app/api/clients/[id]/** passes
on DEV; perf-count before and after for every route under app/api/clients/[id]/**
shows no route reading `clients` more than once; and the Tier B gates pass (the
list in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
perf-count table before and after, rule B's remaining count and where, and
anything you decided that the plan did not say.
```

### P4b — `refactor(routes): the client routes take ClientContext` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `lib/require-client-auth.ts requireClientAuth` returns `{ clientId, ctx }` (its `getAuthenticatedClientId` read becomes
  the narrow context read; the Redis cache stays, D22); every route under `app/api/client/**` passes `ctx`; the services
  they call take it (`services/client-portal-service.ts`, `client-day-service.ts`, `client-habit-figures-service.ts`,
  `client-habit-writes-service.ts`, `daily-log-permissions-service.ts getLogWindow` → `ctx` + one `check_ins` read,
  `client-training-week-service.ts`, `training-event-layout-service.ts`, `client-portal-progress.ts`,
  `client-journey-service.ts`, `check-in-context-service.ts` …). `GET /api/client/me` keeps the full row, read once.
- `scripts/perf-routes.ts` rows for `app/api/client/**` re-measured. Responses unchanged (the contract froze in P3d).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.1, D15, D22,
§5 (Tier B), §6 "How every commit runs" and this entry. From docs/ARCHITECTURE.md
read "Client Portal Architecture". Read lib/client-context.ts (from P4a),
lib/require-client-auth.ts, lib/auth-helpers.ts (getAuthenticatedClientId),
lib/auth-cache.ts, app/api/client/me/route.ts, then every route under
app/api/client/** and each service they call that imports getClientById,
getClientTodayString, getCoachTodayString, getClientWeekAnchor or getLogWindow
(grep them). Read scripts/bearer-proof.ts and scripts/wire-proof-*.ts.

Job: commit P4b of docs/PERF-PLAN.md §6 — `refactor(routes): the client routes
take ClientContext`. Build exactly what the entry lists, to §2.1 and D15. No
response changes by one key (CLIENT-APP-REFERENCE.md is the contract).

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: check:perf rule B's count fell by every service converted;
scripts/bearer-proof.ts and every wire proof pass on DEV; perf-count before and
after for every route under app/api/client/** shows no route reading `clients`
more than once; and the Tier B gates pass (the list in P2e, without check:rls).
The set-tracker test flake: rerun alone and say so. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
perf-count table before and after, rule B's remaining count and where, and
anything you decided that the plan did not say.
```

### P4c — `refactor(routes): every remaining route takes ClientContext; the resolvers leave the service layer; check:perf enforces` · Tier B

**STATUS: PLANNED 2026-10-10.**

- The rest: `app/api/check-in/[id]/**` (`requireCoachOwnsCheckIn` returns `{ coachId, checkIn, ctx }` and the three
  review routes reuse the check-in and the context the helper already fetched — the comparison route's three check-in
  reads and three client reads become one each), `app/api/check-ins/**`, `app/api/content/**` (the download route's
  second session read goes), `app/api/clients/[id]/reminder`, the intake routes, `app/api/coach/**`.
- `services/today-service.ts`, `services/check-in-week-service.ts`: the SQL-reading exports are deleted; what remains is
  pure and lives in `lib/client-context.ts`. `getClientById` is imported only by the two full-row routes.
- `scripts/check-perf.ts`: rule B's baseline is zero; rule E (`perf-count --enforce` over `scripts/perf-routes.ts`) is
  on when `--routes` is passed; `package.json` `check:perf` runs A–D, `check:perf:routes` runs E.
- Docs: ARCHITECTURE "API Route Structure" (ClientContext: who makes it, who takes it), current shape only.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.1, §2.2,
§2.3 (rule E), D2, D15, §5 (Tier B), §6 "How every commit runs" and this entry.
From docs/ARCHITECTURE.md read "API Route Structure". Read lib/client-context.ts,
lib/require-coach-auth.ts (requireCoachOwnsCheckIn), services/comparison-service.ts,
services/check-in-review-input-service.ts, app/api/check-in/[id]/route.ts and its
siblings, app/api/content/download/[contentId]/route.ts, then every remaining
importer of getClientById, getClientTodayString, getCoachTodayString or
getClientWeekAnchor outside app/api/** and lib/** (grep), scripts/check-perf.ts,
scripts/perf-count.ts, scripts/perf-routes.ts.

Job: commit P4c of docs/PERF-PLAN.md §6 — `refactor(routes): every remaining
route takes ClientContext; the resolvers leave the service layer; check:perf
enforces`. Build exactly what the entry lists, to §2.1–§2.3 and D15. Responses do
not change.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: check:perf rule B reports zero and its baseline is zero;
`npm run check:perf:routes` passes with every row of scripts/perf-routes.ts
within budget, or the rows still over budget are listed in the handover with the
commit (P5–P8) that brings each under; every proof script under scripts/ passes
on DEV; and the Tier B gates pass (the list in P2e, without check:rls). lsof -i
:3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the full
perf-count table, the rows still over budget and their owners, and anything you
decided that the plan did not say.
```

### P5a — `perf(check-in): one week reader for the check-in context, the submit and the review` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `services/week-figures-service.ts readWeekFigures(ctx, start, end)` as §2.6 (D16).
- Consumers become pure functions of `WeekFigures`: `services/check-in-context-service.ts` (training, nutrition, habit
  branches), `app/api/client/check-in-context/route.ts` (one reader for the period and one for the current week where
  they differ), `services/daily-logs-service.ts getDailyLogs`, `services/nutrition-period-service.ts`,
  `services/client-adherence-service.ts getClientAdherenceForRange`, `services/check-in-sent-snapshot-service.ts`'s
  period figures, `services/check-in-review-input-service.ts` (the AI input), `app/api/clients/[id]/daily-logs/route.ts`.
- Budgets: the context route ≤ 12 calls; `POST /api/client/check-ins` ≤ 10 reads + 1 rpc; the AI input ≤ 10.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.6, D16, §5
(Tier B), §6 "How every commit runs" and this entry. From docs/ARCHITECTURE.md
read "Check-in System" and "Client Portal Architecture". Read
app/api/client/check-in-context/route.ts, services/check-in-context-service.ts,
services/daily-logs-service.ts, services/nutrition-period-service.ts,
services/nutrition-days-service.ts, services/schedule-data-service.ts,
services/client-adherence-service.ts, services/check-in-sent-snapshot-service.ts,
services/check-in-review-input-service.ts, services/check-in-service.ts (submitCheckIn),
services/client-habit-figures-service.ts (readHabitRange), app/api/clients/[id]/daily-logs/route.ts,
scripts/check-in-submit-proof.ts, scripts/check-in-sent-snapshot-proof.ts,
scripts/check-in-copies-read-proof.ts.

Job: commit P5a of docs/PERF-PLAN.md §6 — `perf(check-in): one week reader for
the check-in context, the submit and the review`. Build exactly what the entry
lists, to §2.6 and D16. The snapshots a submit stores are byte-identical to
before for the same data (the sent-snapshot proof is the judge).

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: readWeekFigures has tests (its two waves, its range bounds); the three
check-in proofs pass on DEV; perf-count before and after for the context route,
the submit and the AI input meets the entry's budgets; and the Tier B gates pass
(the list in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, and anything you decided that the plan did not say.
```

### P5b — `perf(client): the day summary and the program hub read each table once` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `services/client-day-service.ts getDaySummary`: one `readWeekFigures(ctx, date, date)` feeds the four branches;
  the wellness branch answers `hasLog` from the figures; the habits branch reads the day's habits through the figures'
  `habitRange`. Budget ≤ 7 calls.
- `services/client-portal-service.ts` (the nutrition-plan route): the plan, its grid and the week's events read once and
  handed to the day reader (`getNutritionEventsForDateRange` gains an overload that takes prefetched versions, grids
  and events); the three `clients` reads became `ctx` in P4b. Budget ≤ 5.
- `services/client-journey-service.ts`: `listClientGoals` (every goal ever) → `getGoalForDate` reads the one covering
  row (`starts_on <= today` ordered desc limit 1, with its deadlines embed) — the same change in
  `services/client-goals-service.ts getGoalForDate` for every caller.
- Budgets re-measured for `/api/client/day-summary`, `/api/client/nutrition-plan`, `/api/client/journey`, `/api/client/me`.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.6, D16, §5
(Tier B), §6 "How every commit runs" and this entry. From docs/ARCHITECTURE.md
read "Client Portal Architecture". Read services/week-figures-service.ts (P5a),
services/client-day-service.ts, services/daily-logs-service.ts,
services/client-habit-figures-service.ts, services/client-habits-service.ts,
services/client-portal-service.ts, services/nutrition-days-service.ts,
services/nutrition-plan-service.ts, services/client-journey-service.ts,
services/client-goals-service.ts (listClientGoals, getGoalForDate, getCurrentGoal),
app/api/client/day-summary/route.ts, app/api/client/nutrition-plan/route.ts,
app/api/client/journey/route.ts, scripts/wire-proof-server-reads.ts,
scripts/wire-proof-goals.ts, scripts/nutrition-follows-goal-proof.ts.

Job: commit P5b of docs/PERF-PLAN.md §6 — `perf(client): the day summary and the
program hub read each table once`. Build exactly what the entry lists, to §2.6.
Responses do not change.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: getGoalForDate's one-row read has a test (a past, a current and a
future goal); the three proofs named pass on DEV; perf-count before and after
for the four routes meets the entry's budgets; and the Tier B gates pass (the
list in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, and anything you decided that the plan did not say.
```

### P6a — `perf(training): the Training tab reads plan metadata, the calendar invalidates exact keys, and the nutrition plan read is SWR` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `services/training-service.ts getTrainingPlanMetaForDate(ctx, date)` (§2.7); `GET /api/clients/[id]/training` answers
  metadata + session count, `?include=sessions` the program; its consumers on the tab read metadata
  (`training-summary-hero.tsx`, `training-plan-hero.tsx`, `training-calendar-view.tsx`, `training-builder-right-panel.tsx`
  read eight plan-level fields; grep every reader of `plan.sessions` and give each the include it needs).
- The remaining whole-program readers used for `plan.clientId` or `.some(id)` (`events/[eventId]/route.ts`, its
  `move`, `[planId]/route.ts` GET/PATCH/DELETE) use `assertPlanOwned`.
- Exact keys (D17): `hooks/use-calendar-events.ts invalidateTrainingData` and `isClientTrainingAreaKey`,
  `hooks/use-nutrition-calendar-events.ts`'s matcher, `components/clients/metrics/hooks/use-client-blocks.ts
  invalidateBlocks` become explicit key lists; a write seeds its own key and does not refetch it (`use-placed-session-editor.ts`
  from P2c; `plan-editor-overlay.tsx` does not refetch the edit key on save; `blocks-subtab.tsx` does not refetch the
  blocks it just seeded); "clear week" becomes one request: `DELETE /api/clients/[id]/training/[planId]/events?from=&to=`
  (one detach + one delete inside the existing clear helpers).
- `hooks/use-nutrition-plan.ts` becomes `useSWR` on `/api/clients/[id]/nutrition` (TECHNICAL-DEBT entry closed;
  `refetchNutrition` → `mutate`); the Nutrition tab's `/blocks` read mounts with the drawer, not the tab.
- `check:perf` rule D's baseline falls to zero.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.7, D17, §5
(Tier B), §6 "How every commit runs" and this entry. From docs/ARCHITECTURE.md
read "Coach-side Data Flow" and "Training Completion Hierarchy". Read
services/training-service.ts, app/api/clients/[id]/training/route.ts and every
route under app/api/clients/[id]/training/**, hooks/use-training-plan.ts,
hooks/use-calendar-events.ts, hooks/use-nutrition-calendar-events.ts,
hooks/use-nutrition-plan.ts, hooks/use-nutrition-builder.ts,
components/clients/metrics/hooks/use-client-blocks.ts,
components/clients/metrics/blocks/blocks-subtab.tsx, every file under
components/clients/training/ that reads `plan.sessions` or calls
invalidateTrainingData (grep), components/clients/training/plan-editor-overlay.tsx,
components/clients/training/calendar/training-calendar-view.tsx (clear week),
the TECHNICAL-DEBT.md entries "`useNutritionPlan` is not SWR" and
"Nutrition-calendar invalidation", scripts/check-perf.ts (rule D).

Job: commit P6a of docs/PERF-PLAN.md §6 — `perf(training): the Training tab
reads plan metadata, the calendar invalidates exact keys, and the nutrition plan
read is SWR`. Build exactly what the entry lists, to §2.7 and D17.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: check:perf rule D reports zero; the new range-delete route has a test
and a mutation for its ownership; the component tests for the calendar, the tray
and the plan editor pass; perf-count before and after for GET /training (calls
and bytes) and for a move, a delete and a tray save (the refetches that follow,
counted from the proof server's [db] lines); and the Tier B gates pass (the list
in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts and bytes before and after, the §7.6 steps for me, and anything you
decided that the plan did not say.
```

### P6b — `perf(reads): named columns wherever a screen needs a few fields; the review's routes reuse what auth fetched` · Tier B

**STATUS: PLANNED 2026-10-10.**

- The `select("*")` sweep (rule A): every site outside the allowlist selects what its consumer reads; the allowlist
  (`scripts/check-perf-allowlist.ts`) names the rows returned whole (the full client, a check-in's detail, a session
  log's detail, a saved plan's tree, the exercises catalog row) with a one-line reason each; rule A's baseline falls to
  the allowlist.
- The check-in review: the detail route answers the period's wellness rows (so `use-check-in-detail-data.ts`'s second
  wave, `/daily-logs`, goes); the comparison and AI-input routes take the check-in and `ctx` from the helper (P4c)
  and read `previous check-in` with one query; `getExerciseSummariesForPeriod`'s three sequential reads run in one
  wave where independent.
- `GET /api/client/check-ins/[id]`: the unrendered `trainingEventDetails` goes (the client page never reads it; the
  contract froze in P3d — update `CLIENT-APP-REFERENCE.md` if it lists the key).
- `app/api/clients/[id]/route.ts`: one read (if P4a left two).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.3 (rule A),
§2.7, §5 (Tier B), §6 "How every commit runs" and this entry. Run
`npm run check:perf` and read its rule A report: every site is in this commit's
scope. Read app/api/check-in/[id]/route.ts, app/api/check-in/[id]/comparison/route.ts,
app/api/check-in/[id]/ai-summary/route.ts, services/comparison-service.ts,
services/check-in-review-input-service.ts, services/check-in-context-service.ts
(getExerciseSummariesForPeriod), hooks/use-check-in-detail-data.ts,
components/clients/check-ins/check-in-detail-view.tsx, components/check-in/wellness-section.tsx,
app/api/client/check-ins/[id]/route.ts, app/client/check-in/[id]/page.tsx,
scripts/check-perf-allowlist.ts.

Job: commit P6b of docs/PERF-PLAN.md §6 — `perf(reads): named columns wherever a
screen needs a few fields; the review's routes reuse what auth fetched`. Build
exactly what the entry lists. For every select you narrow, name the consumer
that reads each column you keep; a column no consumer reads goes.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: check:perf rule A reports only the allowlist; every existing proof
script passes on DEV; perf-count before and after for the three review routes
and for every route whose select changed, with body bytes; and the Tier B gates
pass (the list in P2e, without check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts and bytes before and after, the allowlist with its reasons, and anything
you decided that the plan did not say.
```

### P7a — `perf(overview): the progression percentage and the PR deltas are two SQL aggregates` · Tier B

**STATUS: PLANNED 2026-10-10.**

- Migration: `get_client_progression_pct(p_client_id, p_from, p_to)` and `get_pr_deltas_since(p_client_id, p_anchor)`
  (§2.8, D18), each with the index its predicates need, each proven equal to the TS result on the perf fixture
  (`scripts/overview-aggregates-proof.ts`: the TS figures from the current code path, kept in the proof as a reference
  implementation, against the function's output for the fixture client).
- `services/overview-plan-summary-service.ts computeProgressionPct` → one rpc; `getTrainingPlanForDate` →
  `getTrainingPlanMetaForDate` (P6a) for the card. `services/client-activity-feed-service.ts detectPrItems` → one rpc.
  `get_client_exercise_list` is called with the window's bounds wherever it is called.
- Budgets: the plan-summary route ≤ 4 calls, the brief route ≤ 8.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.8, D18, D20,
§5 (Tier B), §6 "How every commit runs" and this entry. From docs/ARCHITECTURE.md
read "Coach-side Data Flow" (the Overview). Read
services/overview-plan-summary-service.ts, services/client-overview-brief-service.ts,
services/client-activity-feed-service.ts, services/exercise-analytics-service.ts,
supabase/migrations/191_race_distance_prs_and_every_exercises_bests.sql and
192_drop_every_exercises_bests.sql (the three RPCs these aggregates build on),
app/api/clients/[id]/overview/**/route.ts (grep the Overview's routes),
docs/perf-baseline.md, scripts/perf-baseline.ts, scripts/perf-fixtures.ts,
scripts/seed-scale-client.ts.

Job: commit P7a of docs/PERF-PLAN.md §6 — `perf(overview): the progression
percentage and the PR deltas are two SQL aggregates`. Build exactly what the
entry lists, to §2.8 and D18: the functions ship only if the proof shows the
same figures as the TS for the perf fixture.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/overview-aggregates-proof.ts passes on DEV; each function's
scoping has a test and a mutation; perf-count before and after for the Overview's
routes meets the entry's budgets; `npx tsx scripts/perf-baseline.ts` re-run and
docs/perf-baseline.md refreshed; and the Tier B gates pass (the list in P2e,
with check:rls). Migration: --dry-run, then push to DEV once. lsof -i :3000.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts before and after, and anything you decided that the plan did not say.
```

### P7b — `perf(aggregates): the Programs page's figures, a client's adherence and the attention feed's habits are counted in SQL` · Tier B

**STATUS: PLANNED 2026-10-10.**

- Migration: `get_saved_plans_summary(p_coach_id)`, `count_saved_plan_assignments(p_coach_id)`,
  `compute_check_in_adherence(p_client_id)`, `get_habit_adherence_for_clients(p_client_ids uuid[], p_from, p_to)` (§2.8).
- `services/coach-saved-plan-service.ts getSavedPlansSummary` / `getSavedPlanAssignments` → one rpc each;
  `services/check-in-adherence-service.ts` → the rpc, called after the submit RPC (D7) and nowhere else, only after
  `scripts/adherence-parity-proof.ts` passes for every client of the scale seed (D18); `services/attention-feed-service.ts`'s
  habit branch → the rpc (its sequential paged habit reads go).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.8, D7, D18,
D20, §5 (Tier B and the P7b proof), §6 "How every commit runs" and this entry.
Read services/coach-saved-plan-service.ts (getSavedPlansSummary, getSavedPlanAssignments),
app/api/training/saved-plans/summary/route.ts, app/api/training/saved-plans/assignments/route.ts,
services/check-in-adherence-service.ts (whole: the streak rules are the
specification the SQL must match), services/check-in-service.ts (where it is
called), services/attention-feed-service.ts (the habit branch),
services/client-habit-figures-service.ts, scripts/seed-scale.ts (the proof's
population), supabase/migrations/README.md.

Job: commit P7b of docs/PERF-PLAN.md §6 — `perf(aggregates): the Programs page's
figures, a client's adherence and the attention feed's habits are counted in
SQL`. Build exactly what the entry lists, to §2.8 and D18. The adherence
function replaces the TS only if scripts/adherence-parity-proof.ts shows equal
figures for every client of the scale seed; otherwise the TS stays, the function
ships unused, and the handover says which clients differed and why.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: scripts/adherence-parity-proof.ts has run on DEV against the scale
seed and its result is in the handover; each function's scoping has a test and a
mutation; perf-count before and after for the two Programs routes, the submit
and the attention feed; and the Tier B gates pass (the list in P2e, with
check:rls). Migration: --dry-run, then push to DEV once. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
parity result, the counts before and after, and anything you decided that the
plan did not say.
```

### P8a — `perf(ai): check-in reviews are written after the response; Regenerate is a job the page polls` · Tier B

**STATUS: PLANNED 2026-10-10.**

- Migration: `check_ins.ai_requested_at timestamptz` (D19).
- `POST /api/check-in/[id]/ai-summary`: sets `ai_requested_at`, schedules the generation in `after()`, answers 202
  `{ requestedAt }`; the generation's reads come through the week reader (P5a) and the exercise summaries;
  `components/check-in/check-in-review-section.tsx` polls the detail every 2 s while `aiRequestedAt > aiProcessedAt`,
  shows "Writing the review…", and renders the returned review when it lands (no extra detail refetch beyond the poll).
- The post-submit job (P2a's `after()`) shares the same generation function. A generation failure leaves
  `ai_processed_at` null and logs the error; the poll stops after 150 s and shows "The review didn't finish. Try again."
- Docs: ARCHITECTURE "Check-in System" (the AI job's shape).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.9, §2.10 #7,
D19, D20, §5 (Tier B), §6 "How every commit runs" and this entry. From
docs/ARCHITECTURE.md read "Check-in System". Read app/api/check-in/[id]/ai-summary/route.ts,
services/check-in-review-input-service.ts, services/ai-service.ts,
services/check-in-service.ts (updateCheckInAISummary, triggerAISummaryGeneration
and the submit's after() from P2a), components/check-in/check-in-review-section.tsx,
hooks/use-check-in-detail-data.ts, lib/mappers.ts (the check-in mapper),
supabase/migrations/README.md. Check §2.10 #7 against node_modules/next before
relying on it.

Job: commit P8a of docs/PERF-PLAN.md §6 — `perf(ai): check-in reviews are
written after the response; Regenerate is a job the page polls`. Build exactly
what the entry lists, to §2.9 and D19.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the 202 path, the poll's stop conditions and the 150 s give-up have
tests; perf-count before and after for the ai-summary route (the response's own
calls, with the job's calls listed separately from the [db] lines after the
response); and the Tier B gates pass (the list in P2e, with check:rls).
Migration: --dry-run, then push to DEV once. lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts, and anything you decided that the plan did not say.
```

### P8b — `perf(assistant): the builder assistant streams its turn and keeps the catalog in memory` · Tier B

**STATUS: PLANNED 2026-10-10.**

- `POST /api/training/assistant` answers `text/event-stream`: one event per tool-runner step and per text delta, a final
  event with the ops `finalizeAssistantOps` produces; `components/clients/training/program-builder/assistant/use-assistant-chat.ts`
  consumes the stream and renders as it arrives. `maxDuration` stays; the TECHNICAL-DEBT entry "Deployment prerequisite
  — assistant route needs a >240s function timeout" is removed if streaming keeps every turn under the platform's
  limit (say so in the handover; otherwise the entry stays and says why).
- `lib/perf/catalog-cache.ts`: the coach's resolve catalog for five minutes per instance, invalidated by the exercise
  create/edit/delete routes; `services/assistant/draft-workspace.ts` reads it.

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §2.9, D19, §5
(Tier B), §6 "How every commit runs" and this entry. Read
app/api/training/assistant/route.ts, services/assistant/draft-agent-service.ts,
services/assistant/draft-workspace.ts, services/exercise-catalog-service.ts
(the resolve read), app/api/training/exercises/route.ts and its [exerciseId]
route, components/clients/training/program-builder/assistant/use-assistant-chat.ts
and the dock components beside it, the TECHNICAL-DEBT.md entries "Deployment
prerequisite — assistant route needs a >240s function timeout" and "Draft
assistant — untriaged review-fleet findings".

Job: commit P8b of docs/PERF-PLAN.md §6 — `perf(assistant): the builder
assistant streams its turn and keeps the catalog in memory`. Build exactly what
the entry lists, to §2.9. The ops the assistant produces for a given transcript
do not change (the existing assistant tests are the judge).

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the stream's event shapes and the cache's five-minute and
invalidation rules have tests; the existing assistant tests pass unchanged;
perf-count before and after for the assistant route shows the catalog read gone
on the second turn; and the Tier B gates pass (the list in P2e, without
check:rls). lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed, the
counts, whether the TECHNICAL-DEBT entry closed, and anything you decided that
the plan did not say.
```

### P9 — `docs(perf): CONVENTIONS carries the four rules and marks every rule gated or not; ARCHITECTURE and TECHNICAL-DEBT say what is` · docs only

**STATUS: PLANNED 2026-10-10.**

- CONVENTIONS.md: the six P0 rules are already in; this commit gives every OTHER rule in the file a trailing marker:
  `[gate: check:labels]`, `[gate: check:rls]`, `[gate: check:perf A]`, `[gate: tsc]`, `[gate: review]`, or
  `[ungated]`. The ungated list is pasted into the handover.
- ARCHITECTURE.md: the sections §4 names, current shape only, one pass over the whole file for sentences that describe
  what this plan removed.
- TECHNICAL-DEBT.md: D21 added; the entries §4 lists as closed are gone; the first section's "two pools per server"
  line unchanged.
- `docs/perf-baseline.md`: refreshed by P7a; this commit only checks its header names the SHA.

```text
Read docs/PERF-PLAN.md whole, then CONVENTIONS.md whole, docs/ARCHITECTURE.md
whole, TECHNICAL-DEBT.md whole, and `git log --oneline` since P0's hash.

Job: commit P9 of docs/PERF-PLAN.md §6 — `docs(perf): CONVENTIONS carries the
four rules and marks every rule gated or not; ARCHITECTURE and TECHNICAL-DEBT say
what is`. Docs only, to §4: ARCHITECTURE describes the current shape and never
what used to be; a removal leaves no sentence behind; CONVENTIONS gains the
gate markers on every rule P0 did not already mark, and loses nothing.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a claim you must write is not true of the code as committed.

Done when: every sentence you added names code or a script that exists at HEAD,
checked by opening it; no gate runs for a docs-only commit; and the ungated list
is in the handover.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: the ungated rules,
one line each, and anything you found in the docs that this plan did not say.
```

### P10 — `test(perf): a Sunday evening against DEV — the load test, and docs/load-test.md` · Tier B

**STATUS: PLANNED 2026-10-10.** After P9, and again before the first paying coach, on PROD-sized compute.

- `scripts/load-test.ts` (autocannon as a dev dependency, or `undici` with a concurrency pool — the session picks and
  says why): against the proof server pointed at DEV with the scale seed (`scripts/seed-scale.ts --confirm`, 25 coaches
  × 20 clients), signed in as seeded coaches and clients through `scripts/auth-fixtures.ts`. One scenario, ten
  minutes, run twice: 200 clients each submit a check-in (the P2a proof's payload) spread over the window, while 20
  coaches each open the dashboard with its three polls, one client Overview and one Training tab. Measures per route:
  requests, p50, p95, max, error count; and from `[db-burst]` lines, calls per request under concurrency (they should
  equal the single-request counts — a difference means pool queueing).
- During the run the owner screenshots Supabase → Reports (CPU, pooler client connections, slow queries) and Vercel's
  function concurrency; the session cannot read those.
- `docs/load-test.md`: the fixture, the scenario, the table, the three screenshots' numbers, and one paragraph: the
  first thing that saturated, and what tier removes it. Thresholds that make the run a pass: p95 under 1 s for every
  GET, under 2 s for the submit, zero 5xx, zero 429 for coaches on distinct IPs.
- Every row the run creates is deleted in `finally` (the seed's teardown).

```text
Read CONVENTIONS.md (whole) and from docs/PERF-PLAN.md its head, §1 "What the
code cannot settle", §2.2, §5 (Tier B), §6 "How every commit runs", this entry
and §9. Read scripts/seed-scale.ts, scripts/seed/teardown.ts, scripts/proof-server.ts,
scripts/proof-session.ts, scripts/auth-fixtures.ts, scripts/perf-count.ts,
scripts/check-in-submit-proof.ts (the submit payload), docs/perf-baseline.md
(the report's shape).

Job: commit P10 of docs/PERF-PLAN.md §6 — `test(perf): a Sunday evening against
DEV — the load test, and docs/load-test.md`. Build exactly what the entry lists.
Before the run, tell me the minute it starts so I can watch the Supabase and
Vercel dashboards; stop and wait for my "go".

You have my go on the build: don't show me a plan and don't wait for my review.
Stop and ask me only for the run's start, if a decision this commit needs is
blank, if building it would break a CONVENTIONS.md rule, or if a gate fails and
its root fix lies outside this commit.

Done when: the scenario has run twice on DEV with the scale seed and every row it
made is gone; docs/load-test.md holds both runs' tables and the paragraph the
entry asks for; any route that failed a threshold is listed with the mechanism
you believe saturated and whether the fix is code (name the commit it belongs
to) or tier; and the Tier B gates pass (the list in P2e, without check:rls).
lsof -i :3000 first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: the two tables, the
first thing that saturated, and what you would size from it.
```

---

## 7. The smokes (Tier A, and two pages)

The session seeds (`scripts/seed/**`, the perf fixtures, or a throwaway under the owner's coach, deleted after); the
owner runs the steps in the browser at `localhost:3000` with `PERF_COUNT=1` and reads the `[db-burst]` lines in the dev
terminal. One action per step.

### 7.1 A client's check-in (after P2a)

Seed under your coach: "Smoke · check-in", active, a program covering this week with three sessions (one logged), a
nutrition version covering the week, one habit ticked twice this week, two logged days of nutrition and wellness, a
check-in form with two questions, next check-in due today. Sign in as the client (the seed prints the login).
1. Open `/client/check-in`. The wizard shows this week's three sessions, the nutrition days, the habit, the two
   questions. Terminal: one burst for the context; note its call count.
2. Enter weight 81.4 and body fat 18, answer both questions, add one photo, submit. "Check-in sent" (or today's
   success copy). Terminal: one burst with exactly one `rpc submit_check_in_atomic` line and no `postgrest` insert lines.
3. As your coach, open Smoke · check-in's Check-ins tab: the check-in is listed; open it: the two readings appear in
   the KPI ribbon, the answers in their section, the photo. Within a minute the AI summary appears.
4. Journey → Physique: the two readings are in the log with source "check-in".
5. As the client, open `/client/check-in` again: "You've checked in for this period" (today's copy), not the form.
6. The session hands over the proof's output showing the refused submit left no row in any table.

### 7.2 Logging a workout (after P2b)

Seed: "Smoke · workout", today's session with three exercises of three sets each.
1. Open today's workout, fill 3×3 with weights and reps, complete it. The tracker shows the saved state. Terminal: one
   burst, one `rpc log_training_event_atomic`.
2. Reopen the workout: the nine sets are as entered. Change one set, save: the change stands, no duplicate rows (the
   coach's Training tab Data pane shows one session log for today).
3. Home: today's training card says done.

### 7.3 The coach's per-day edit (after P2c)

Seed: "Smoke · tray", a program placed from next Monday, Tuesday's session with three exercises.
1. Training tab → Plans pane → click Tuesday → the tray opens with three exercises. Rename the session, remove one
   exercise, add "Goblet squat" 3×10 by typing its name, save. Tray shows the result. Terminal: one burst with one
   `rpc replace_training_session_atomic`, ≤ 3 reads before it, and no refetch of `/training` afterwards (P6a makes
   this stricter; today only the tray's own key is not refetched).
2. Reopen Tuesday: the three exercises are as saved; Goblet squat carries a catalog id (the exercise shows its
   muscle group).
3. Wednesday's event still shows the old session name; Tuesday's shows the new one.

### 7.4 Dropping a library session (after P2d)

Seed: "Smoke · drop", a program placed from last Monday (so yesterday is inside it), one library session "Smoke ·
library session".
1. Plans pane → open the library → drag Smoke · library session onto next Thursday. It appears. Terminal: one
   `rpc place_library_session_atomic`.
2. Drag it onto yesterday. Refused with today's copy for a past day; nothing appears; the session count in the
   program's hero is unchanged.

### 7.5 The histories (after P3a)

Seed: "Smoke · history", a program of four sessions a week for 40 weeks ending today, all logged; nutrition logged
every day for 40 weeks.
1. Training tab → Data pane. The history shows the last ten days newest first; the total says 280 days. Terminal: one
   burst with ≤ 3 `postgrest` lines.
2. Next page, twice: days 11–20, then 21–30, no day repeated, no day missing (compare the dates). The total is the
   same on every page.
3. Nutrition tab → Data pane: the same three steps.

### 7.6 The Training tab after a calendar action (after P6a)

Any client with a program.
1. Open the Training tab: terminal shows the `/training` response under 10 kB (the `[db]` line's bytes) — not ~210 kB.
2. Plans pane: drag one session to another day. Terminal: the move's burst, then exactly one refetch, of the month's
   events, and no `/training` line.
3. Click "Clear week" on a future week with four sessions: one burst, one request (not four).

---

## 8. DEV first, then PROD

- Each migration lands on DEV in its own commit (§6 block, item 8). After P2a–P2f, P7a, P7b and P8a the DEV catalog
  holds nine new functions and one column; `npm run check:rls` after each confirms service_role-only execution.
- PROD takes them after the Better Auth switch (`docs/BETTER-AUTH-PLAN.md` §8.2), in migration-number order, in one
  sitting: `--dry-run --linked --project-ref etezzztgafcotyahgijk`, then the push (the owner runs it; it auto-confirms
  when not a TTY), then `check:rls` against PROD and `npm run check:perf:routes` against a PROD-pointed proof server
  with a throwaway coach.
- `vercel.json`'s region applies on the next deploy. Confirm with `curl -sI https://<deploy>/ | grep x-vercel-id` (the
  prefix is the region).
- Undo: every function is additive; a commit's service change is reverted by `git revert` and the function left in
  place does no harm. The `ai_requested_at` column is nullable and ignored by older code.

---

## 9. What the owner does

1. Before P1: confirm the Vercel plan allows a region choice and that `dub1` is offered; confirm Upstash's primary
   region (console → the database → Region). If it is not eu-west-1, create one there and rotate the two env values in
   Vercel and `.env.local`.
2. Before P3a: read PostgREST's "Max rows" in the Supabase dashboard (Settings → API) for DEV and PROD and write the
   value into §2.10 #4.
3. Put `PERF_COUNT=1` in `.env.local` after P0 and leave it.
4. Run the §7 smokes on the days the week table names; a failed smoke is a stop for that commit, not for the plan.
5. After Day 4, start the client app against `CLIENT-APP-REFERENCE.md` as P3d left it.
6. After Day 7, run the Better Auth PROD switch (§8.2 there), then this plan's §8.
