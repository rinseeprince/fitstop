  **This file is mandatory reading.** Claude Code must read this file in full before planning or implementing any code changes. Do not skip sections. Do not assume patterns - follow what is documented here.

  # CoachHub Development Conventions

  ## 1. Engineering Philosophy
  - **No band-aid fixes**: Never work around symptoms. Always investigate and understand the root cause before implementing a fix.
  - **Quality over speed**: Take the time to build clean, maintainable solutions rather than quick hacks that create technical debt.
  - **Understand before implementing**: When something doesn't work as expected, research why. Read documentation, check for known issues, and understand the intended design before writing code.
  - **If it feels wrong, it probably is**: If a solution requires fighting against the framework or library's design, step back and find the proper approach.
  - **Model data relationally, and review normalisation on every schema change.** Before any
    plan proposes a column, ask of the data: *does anything reference it? is it edited in
    place? is it ordered? is it shared between owners? will anyone want its history or
    per-item analytics?* One "yes" means a **table with its own id and foreign keys** — never
    a `JSONB` array or `TEXT[]` on an existing row. JSONB is for value-bags and frozen snapshots
    with no identity (`set_specs`, `period_snapshot`), and "there is already a JSONB column on
    this table" is not a precedent. The data model is an **explicit owner decision** in every
    plan, stated with its alternatives, never adopted silently from a draft. Sanctioned
    denormalisations (submit-time snapshot columns like `check_ins.workouts_completed`, the
    per-event `training_events.calorie_surplus_percentage`) are
    documented as such in `docs/ARCHITECTURE.md`; an undocumented one found in passing is debt
    to record, not a shape to copy. Full rule: §8 → "Data modelling". *(Added 2026-08-29 after a
    plan put a coach's check-in questions on `clients` as JSONB and snapshotted the prompt onto
    each answer to hide that nothing could reference a question — a band-aid that reached the
    owner's desk before it was caught.)*

  ## 2. Claude Code Behavior

  ### Planning
  - Always show a plan before writing code. Never start coding without approval.
  - Identify which existing files will be affected before creating new ones.
  - Check for existing patterns in the codebase before inventing new ones (e.g. check how other hooks work before creating a new hook).

  ### Scope discipline
  - Implement exactly what's asked, not what you think might be needed later.
  - Don't add optimistic updates, caching strategies, or performance optimizations unless explicitly requested.
  - Simple and working beats clever and fragile.
  - One fix per change. Don't fix a bug AND refactor the component AND update the styling in the same edit. If something breaks, you can't tell which change caused it.

  ### Debugging
  - Debug first, fix second. Add console.logs and show the output before changing logic.
  - Never guess at the root cause - prove it with evidence.
  - When reverting a fix that made things worse, revert only the specific changes, don't rewrite the file.
  - **Stale `.next` cache after refactors.** Next.js maintains an incremental build cache in `.next/` that survives dev server restarts. After a large refactor that moves/renames files (≥5 files), the cache can carry zombie entries for deleted routes and miss newly-added ones. Symptoms: routes that exist on disk return 404, services silently no-op while returning "success", or TypeScript shows phantom errors in `.next/dev/types/routes.d.ts`. Before debugging further, try: stop the dev server, `rm -rf .next`, restart. Solves ~90% of post-refactor weirdness in under a minute. If the bug persists after a clean rebuild, it's a real bug.

  ### Don't silently change working code
  - If a fix requires changing an unrelated file, call it out before doing it.
  - Never refactor surrounding code while fixing a bug.
  - If something already works, don't touch it.

  ### Read before writing
  - Before modifying a file, read the full file first. Don't assume what's in it based on the filename.
  - Before creating a new hook or utility, search the codebase for existing ones that do the same thing.
  - Before changing an API response shape, check every file that consumes that endpoint.

  ### No duplicate logic
  - Before creating a new hook, check if an existing hook already fetches the same data.
  - Before creating a new utility function, search for existing helpers that do the same thing.
  - If two components need the same data, lift the fetch to a shared parent or shared hook - don't fetch the same endpoint twice.
  - If duplicating logic across client and coach components, extract to a shared utility in `/utils` or `/lib`.
  - When 3+ functions share the same structural pattern (e.g. fetch/error/toast/mutate, try/catch/validate/respond, query/auth-check/error-handle), extract a shared helper. Prefer one well-tested helper over duplicated try/catch blocks. Helpers should live close to their consumers - in the same file for hook-specific helpers, or in `/lib` or `/utils` for cross-cutting patterns.
  - Extracting logic you're about to duplicate may mean editing a file outside the task at hand. That's allowed - it's not a scope violation - as long as you surface it per "Don't silently change working code," and verify the touched file's tests still pass.

  ### Don't assume success
  - Don't say "all done, everything works" without verifying. Show proof: terminal output, build results, or explain what was tested.

  ### Don't install packages without asking
  - If a task can be done with what's already in the project, don't add a new dependency. Always ask before running `npm install`.

  ### Never run `npm audit fix --force`
  - `npm audit fix` (no flag) is safe — it only takes semver-compatible bumps. Run it, then `npx vitest run`, then commit the lockfile.
  - `--force` installs breaking majors and npm's resolver walks *backwards* to find a version without the advisory. On 2026-07-22 it proposed `next@9.3.3` — a 2020 release, seven majors back — to clear a transitive `sharp`/`postcss` advisory. It would have destroyed the app.
  - Audit production dependencies with `npm audit --omit=dev`. Dev-only advisories (vitest, esbuild, build tooling) don't ship to users and are noise for a launch check.
  - Before acting on any advisory, check it is **reachable in this app** rather than merely present. `next.config.mjs` sets `images.unoptimized = true` and nothing imports `next/image`, so `sharp` is never invoked and its libvips CVEs have no path; `postcss` is build-time only and our CSS is first-party. Record the reachability finding in the commit message so the next person doesn't re-litigate it or panic-run `--force`.

  ### Respect existing architecture
  - Don't switch from snake_case to camelCase mid-file.
  - Don't introduce a new state management library when one is already in use.
  - Don't change the response format of an API that other components already consume.
  - Match the pattern from the nearest similar file in the codebase.

  ### Don't break the mock contract
  - When adding exports to a module, check if tests mock that module and update the mock.
  - When changing a function signature, check if tests call that function and update them.

  ### Naming for the audience
  - UI labels should make sense to coaches and clients, not developers.
  - No "Boolean", no "JSONB", no "isActive" in the interface. Use plain language.

  ### Security, load & performance review — REQUIRED after any large change
  **Priority: high. This is not optional and it is not "if there's time".** Run it and report the
  findings unprompted — the product owner should never have to ask "is this safe and will it hold
  under load?" after an implementation lands.

  **Triggers — run it if ANY apply.** Do not debate whether a change is "large"; if it trips a
  trigger, run the review:
  - a new migration, table, or column
  - a new API route, or any change to an existing route's auth, ownership, or validation
  - a new write path, or a change to how much/how often an existing one writes
  - a completed numbered session or phase of an execution plan
  - roughly ≥5 files or ≥200 lines touching data flow

  **Security — check each, cite `file:line`:**
  1. Write routes carry `coachApiRateLimit` **and** `requireCSRFProtection` (§9/§10).
  2. Authenticated (`getAuthenticatedCoachId` / `getAuthenticatedClientId`, **passing `request`**)
     AND a tenant-ownership check — a foreign resource must 403/404, not proceed.
  3. zod validation before any write.
  4. The write itself is scoped to the tenant (`.eq("client_id", …)`) as defence in depth, so a
     forged id matches zero rows.
  5. `npm run check:rls` — every table has RLS, no policy is trivially true for `authenticated`,
     none is reachable by `anon` without keying on `auth.uid()`, and every view is
     `security_invoker`. It does not judge whether a policy is tenant-scoped, it reads no grants,
     and it reads the linked project only, so check a new policy's scoping yourself. Never assert
     RLS state from the docs; the live catalog is the source of truth.
  6. Anything writing via `supabaseAdmin` bypasses RLS — confirm the route authorizes it.

  **Performance — check each:**
  7. Round trips per request are **constant, not per-row**. No query inside a per-item loop.
  8. Writes are batched into one statement, not issued per row.
  9. Every new `WHERE` / `ORDER BY` is index-covered, and every upsert `onConflict` target is
     backed by a real `UNIQUE` constraint — not a plain index.
  10. State the **worst-case row count** for the write, not the typical one.
  11. Sequential `await`s make latency the *sum* of round trips. Parallelise independent reads.

  **Consistency — the failure mode that hides:**
  12. Flag any `.catch()` that logs and lets the request return success **after** an earlier write
      committed. That is a silent divergence: the user sees 200, the data is half-updated, and it
      surfaces to Sentry rather than to them. Say so explicitly, and propose surfacing it or making
      the operation retryable/idempotent.
  13. Where two writes are not in one transaction, state what is left inconsistent if the second
      fails.

  **Reporting — separate what you verified from what you inferred.** Reading code is not measuring.
  If you have not run load against it, say so plainly and name what is untested (read paths under
  concurrency, pool behaviour, aggregations) rather than implying coverage you do not have. Offer
  to measure using the scale seed: the fixture coach is `PERF_COACH_ID` (`scripts/perf-fixtures.ts`), and the measured client baseline is `docs/perf-baseline.md`.

  ## 3. Coding Standards

  ### Match existing patterns exactly
  - If the codebase uses `fetch` for API calls, don't introduce `axios`.
  - If it uses SWR, don't add React Query.
  - If error toasts use `toast.error()`, don't switch to `console.error`.
  - Copy the pattern from the nearest similar file.

  ### No hardcoded values
  - No magic numbers or strings. Use constants, env variables, or config.
  - If a threshold appears twice, it should be defined once in `/lib/constants.ts`.

  ### Handle edge cases upfront
  - Empty states, null values, loading states, error states.
  - Don't just build the happy path and fix edge cases later.

  ### Comment the why, not the what
  - Don't write `// set loading to true`.
  - Do write `// debounce prevents rapid API calls during date navigation`.

  ### Fail loudly in dev, gracefully in prod
  - Throw errors during development so bugs surface fast.
  - Catch and display friendly messages in production.

  ### Never swallow errors silently
  - No empty catch blocks. Always log the error or surface it to the user.
  - An error you can't see is an error you can't fix.

  ### Preserve backwards compatibility
  - If existing clients/pages already work, new code shouldn't break them.
  - Additive changes over breaking changes.

  ### Component communication
  - Props down, callbacks up. Parent owns state.
  - No `onDataChange` useEffect patterns - these cause infinite loops.
  - Child components are controlled/presentational.

  ### Dialog/modal structure
  All dialogs follow this pattern:
  - `<Dialog open={open} onOpenChange={onOpenChange}>` controlled by parent
  - `DialogContent` > `DialogHeader` > body > `DialogFooter`
  - Submit buttons show `<Loader2 className="h-4 w-4 animate-spin" />` during loading
  - Close via `onOpenChange(false)`, not separate close state
  - A dialog about a record takes `open` and the record apart (`useDialogSubject`, `hooks/use-dialog-subject.ts`): the close flips `open` and leaves the record, the next open replaces it, so the closing card still shows what it showed (§7 → "No frame disagrees", rule 5)
  - Forms use React Hook Form with `zodResolver(schema)` and `defaultValues`

  ### Toast notifications
  - `import { toast } from "sonner"` and call it directly — there is no hook.
  - Success: `toast.success("Session saved")`; a consequence, when there is one, as `{ description }`.
  - Failure: `toast.error("Save failed", { description: "What went wrong" })`.
  - A confirmation with no verdict: plain `toast("Nothing to clear")` (no icon).
  - Exactly one toaster — `components/ui/sonner.tsx`, mounted by `app/layout.tsx`. Never mount a second, never restyle a toast at a call site; `components/toaster-ownership.test.ts` scans for both. Copy rules: `docs/newdesignsystem.md` → Toasts.

  ## 4. File Size Limits
  - Components: Max 250 lines (split at 300)
  - Services: Max 300 lines (split at 400)
  - API routes: Max 250 lines (split at 300)
  - Utils: Max 150 lines (split at 200)
  - Hooks: Max 300 lines (split at 350)

  When files exceed limits, extract:
  - Sub-components
  - Custom hooks
  - Service functions
  - Helper utilities

  These limits are guidelines for catching runaway files, not hard rules. If a file exceeds the threshold but its contents are cohesive (single responsibility, tightly coupled state), that's fine. Only split when you can identify a natural boundary - a reusable sub-component, an independent service concern, a separable hook. If the only way to split is scattering one flow across multiple files connected by prop-drilling or re-exports, the cure is worse than the disease.

  ## 5. Code Style
  - Use Tailwind for styling
  - Lucide icons only
  - Instrument Sans (UI text) + JetBrains Mono (numerical data) - see `docs/newdesignsystem.md` for the full typography spec
  - Async/await over promises
  - Named exports over default
  - No `as any` type casts - use proper types from `types/database.ts`. If extending an existing type, create a local interface.

  ## 6. File Structure
  ```
  /app           - Next.js App Router pages and API routes
    /(coach)       - The coach application boundary: every trainer-facing page, under `app/(coach)/layout.tsx` (ARCHITECTURE → "Coach route group"); `trainerRoutes` in `middleware.ts` is bound to this folder by test
    /client        - The client portal, under `app/client/layout.tsx`
  /components    - React components
    /clients       - Coach-facing: a coach viewing their clients' data (plural)
    /client        - Client-facing: pre-activation flows (onboarding, walkthrough, waiting state)
    /client-portal - Client-facing: post-activation portal (home, detail pages, nav, settings)
    /ui            - Shadcn/Radix base components (vendored generator output; its unused sub-exports are not refactor residue and are not swept — `knip.json` ignores the folder for that reason, and `types/database.ts` because `supabase gen types` rewrites it whole)
  /services      - Business logic and data operations
  /utils         - Helper functions (AI, nutrition, training calculations)
  /hooks         - Custom React hooks
  /types         - TypeScript definitions
  /lib           - Constants, helpers, utilities
    /validations - Zod schemas (auth, check-in, client, nutrition, training, assistant, etc.)
    (constants live in the flat `lib/constants.ts`; training-only constants in `lib/training-constants.ts` - there is no `lib/constants/` directory)
  /contexts      - App-wide React context providers (auth, intake-panel, motion-preferences, nutrition-builder, training-builder, units). Feature-scoped providers mounted by a route layout live beside their feature instead - e.g. `components/clients/training/program-builder/program-draft-provider.tsx`, which owns all training authoring state.
  /emails        - React Email templates (Resend)
  /supabase      - Database migrations and config
  /docs          - Architecture documentation
  /scripts       - Utility scripts
  /styles        - DEAD. `styles/globals.css` is imported by nothing; `app/layout.tsx` imports `app/globals.css`. Edit the `app/` copy, and verify the change in the emitted bundle rather than the source.
  ```

  Key lib files:
  - `lib/rate-limit.ts` - Rate limiting tiers (Upstash Redis + in-memory fallback)
  - `lib/csrf-protection.ts` - CSRF origin/referer validation
  - `lib/error-handler.ts` - Sentry error capture wrapper
  - `lib/swr-fetcher.ts` - SWR fetcher with error handling
  - `lib/auth-helpers.ts` - `getAuthenticatedCoachId()`, `getAuthenticatedClientId()`
  - `lib/auth-cache.ts` - Short-TTL (60s) `user_id → client_id` auth-resolution cache (Session 3.8)
  - `lib/cursor.ts` - Opaque base64url keyset cursor encode/decode for paginated reads (Sessions 3.7/3.9)
  - `lib/date-helpers.ts` - Date/timezone helpers; the ONLY surface owning `Intl.DateTimeFormat` math (`getTodayDateStringInTimezone`, `getTodayInTimezone`, `getDeviceTimeZone`)
  - `services/today-service.ts` - DB-fetching "today" helpers for bare ids: `getClientTodayString` (client→coach→UTC fallback), `getCoachTodayString`

  ### Component folder audience conventions

  The `components/` tree has three audience-scoped folders that are easy to confuse because of the singular/plural difference. They are **parallel audiences**, not refactor-before-and-after, and files never move across them.

  - **`components/clients/`** (plural) - **coach-facing**. A coach viewing, editing, or managing their clients' data: training plans, nutrition plans, history tables, check-in review, attention feed, etc.
  - **`components/client/`** (singular) - **client-facing, pre-activation**. Flows the client sees before their coach has fully activated them: intake/onboarding (`client/onboarding/`) and the guided walkthrough (`client/walkthrough/`).
  - **`components/client-portal/`** - **client-facing, post-activation**. The logged-in client portal after activation: home day view, detail pages (training, nutrition, wellness, habits), navigation, settings, etc.

  Rule of thumb when placing a new component:
  1. Is the coach the primary viewer? → `components/clients/`.
  2. Is this shown to a client who has not yet been activated by their coach? → `components/client/`.
  3. Is this shown to an activated client inside the portal? → `components/client-portal/`.
  4. Never mix audiences in the same file. A component used by both coach and client belongs in `components/` or `components/ui/`.

  ### Where training UI lives (post builder overhaul)

  Two sibling folders under `components/clients/training/` are easy to confuse:

  - **`program-builder/`** — the real authoring surface: the weeks × Day-1-7 grid, session editor, library panel, progression dialog, assistant dock, and `ProgramDraftProvider`. Mounted by `/dashboard/programs/[savedPlanId]`, remounted inside the client Training drawer via `target="client-draft"`, and mounted over a client's plan as it is on the calendar via `target="placed-plan"` (the plan editor — its one date rule in `program-builder-lock-model.ts`, saved through the plan editor's PUT). All new training authoring goes here.
  - **`builder/`** — the client-attached drawer + the plan editor's mount: `training-plan-builder-overlay.tsx` (the drawer, a library browser that remounts `program-builder/` via `target="client-draft"`), `training-plan-builder.tsx` (tabs + chrome, and the address of the tray and both editors), `training-builder-right-panel.tsx` (calendar + hero), `plan-editor-overlay.tsx` (the full-screen `placed-plan` mount) and `client-draft-leave-guard.tsx` (the soft-navigation guard for the client draft editor). **Browse, apply, and mount only** — if you find yourself adding an editor here, you want `program-builder/`.

  Also live under `training/`: `calendar/` — the client's event calendar plus the placed-session tray (`placed-session-editor.tsx`, a 780px Sheet hosting the shared `session-editor-body` over a one-slot draft). The old `sessions/` folder (the legacy drawer's add-exercise dialog + exercise row) was deleted with the drawer in the placed-plan editing overhaul.

  ## 7. Data Fetching & State

  ### Data fetching (all surfaces)
  - Use SWR for all new data fetching - coach-side and client portal alike.
  - Use `swrFetcher` from `lib/swr-fetcher.ts` (throws on non-OK responses so SWR preserves previously cached data).
  - SWR config should include: `revalidateOnFocus: false`, `errorRetryCount: 3`, `errorRetryInterval: 1000`.
  - Use `isLoading` for initial load skeletons, NOT `isValidating` (which fires on background refetches).
  - Dedupe rapid requests with `dedupingInterval: 2000` where appropriate (especially anywhere the user can trigger rapid navigation, e.g. day-swipe in the client portal).
  - Include `onError` callback for debugging failed fetches.
  - Client-facing GET API routes should return `Cache-Control: no-store` headers.

  ### Refreshing after a write

  SWR's `mutate` is bound to the component that read the data. A write on one
  screen cannot reach another screen's cache. Nothing fails — the other screen is
  simply stale until someone refreshes, which is why this bug keeps being written.

  - **Every SWR read lives behind a hook that exports both the key builder and an
    invalidator matching it.** Never build a key inline at a call site.
  - **Invalidators match an API *area*, not one endpoint** — `/api/clients/{id}/training`,
    never `/api/clients/{id}/training/events?`. A narrow prefix silently excludes
    every reader added later. The key builder stays narrow; only the matcher widens.
  - **Every mutating call site invokes the invalidator for every area that READS
    what the write touched** — not merely the area the endpoint belongs to. On
    success, before closing or navigating. A training write changes what the
    nutrition days are computed from, so it calls both.
    **The reading half is the one that gets missed**, because the obvious check
    is "which endpoint did I just POST to?" and the answer excludes every
    *derived* read. Placing a program POSTs to `/training/place-from-library` and
    writes no `client_phases` row at all — but `GET /clients/[id]/blocks/facts`
    computes the Journey block cards **from** training plans and nutrition
    versions, so it is wrong the instant that POST lands. Ask "what does this
    data appear on?", never "what table did I write?".
    Cheap way to find them: grep the invalidator's consumers. **An area whose
    only consumer is the screen that owns it is the smell** — every other screen
    that changes its inputs is missing a call.
  - **A read that renders a DEFINITE answer is CLEARED, not merely
    revalidated.** SWR keeps serving the stale entry for the whole refetch, so a
    component that renders "Not set" / "None" / a count from it publishes
    something false for as long as the request takes — and the pending branch
    never fires, because `isLoading` is false whenever there is cached data.
    `mutate(key, undefined, { revalidate: true })` drops the entry and refetches,
    which puts the reader into the pending state it already has. Use the plain
    invalidator for reads whose stale value is merely *old* (a list, a chart);
    clear the ones whose stale value is a *claim*.
  - **Never fix a post-write flash by reordering.** Closing local UI state and
    awaiting a revalidation cannot batch — one of them is a network round trip —
    so whichever you put first decides which stale frame renders, and there is
    always one. If the write's own response carries the new data (most do here),
    seed it into the cache and set the local state in the **same tick**: React
    batches them and no frame exists between. `useSeedClientBlocks`
    (`components/clients/metrics/hooks/use-client-blocks.ts`) is the reference.
    None of this is reachable by any gate in this repo — jsdom renders without
    painting, so no test can observe a frame.
  - **Anti-pattern:** relying on the `mutate` returned by your own `useSWR`. That
    reaches only your component. The moment a second screen reads the same data it
    goes stale, and nothing errors — it just needs a refresh.
  - Components that seed state once from SWR and ignore revalidation must gate on
    freshly-settled data, not whatever is in the cache.

  The two reference implementations are `useInvalidateTrainingData`
  (`hooks/use-calendar-events.ts`) and `useInvalidateNutritionCalendar`
  (`hooks/use-nutrition-calendar-events.ts`). The clearing form's are
  `useClearBlockFacts`, `useClearClientOverview` (`hooks/use-client-overview.ts`)
  and `useClearAttentionFeed` (`hooks/use-attention-feed.ts`): every calendar
  writer calls the last two on success, and `hooks/use-client-overview.test.ts`
  scans the tree for one that does not.

  **Known gap:** this is a rule for new and touched code, not a claim about the
  codebase. Coach-side SWR reads written before the rule may sit behind no invalidator, and
  a handful of inline `globalMutate("literal key")` calls predate the rule. Widen an area's invalidator when you touch it; do not assume a
  read you depend on is already covered.

  ### Nutrition calendar cache invalidation (landmine)
  - The coach nutrition calendar renders from an SWR cache keyed per month window (`/api/clients/{clientId}/nutrition/events?startDate=...&endDate=...`). The days it shows are COMPUTED on the server (ARCHITECTURE → "The window is the row") — nothing is stored per day, so nothing can tell the cache it is stale. **Any client-side success path whose server route changes what a day is computed from** — a nutrition version's window or grid (the plan save and delete, a block save that trims its plans, the block delete), a session on a date or its surplus (place, move, duplicate, delete, the plan editor's save, a program's start-date move), a per-day edit or reset — **must call `useInvalidateNutritionCalendar` from `hooks/use-nutrition-calendar-events.ts`**, or the calendar silently shows stale targets until a page refresh. The client's own week move changes the same days but runs in the client's browser, and an invalidator reaches only the SWR cache of the browser that calls it: no client-side call can refresh the coach's nutrition calendar, which does not revalidate on focus, so it stays stale until it refetches. Do not add a call there that cannot reach its reader.
  - The key-builder and invalidator are co-located in that hook module deliberately so they can never drift. Never construct a `/nutrition/events` key anywhere else.

  ### State management
  - Server state: SWR.
  - Form state: React Hook Form with Zod where applicable.
  - Local component state: useState.
  - URL state: Search params — filters, pagination, and anything deep-linkable (see below).
  - No useState for server data - use SWR.

  ### URL-driven UI state

  Any UI state that can be deep-linked, bookmarked or shared — the active tab, an open pane, a
  selected record — lives in the URL and nowhere else.

  - **The URL is the single source of truth.** `useState` must not mirror or shadow a search param.
    Derive the value from `searchParams` on every render; a setter writes the URL and sets no state.
  - **Navigation is atomic.** Every param a click affects — the tab AND the record it opens — goes
    into ONE router update, so they land on the same render frame. A component reading a param on
    arrival then always sees the value intended for it.
  - **A place pushes, a refinement replaces.** A tab, a pane, an opened record, a roster view, the
    Training tab's apply tray and a full-screen editor push a history entry, so browser Back returns
    one step; the metric, a filter, a sort and a one-shot strip replace. A page's arrow leaves the page — back to the entry before it
    began — when a coach page precedes it, else to its parent (`lib/coach-history.ts`). The
    classification of every writer is in `docs/ARCHITECTURE.md` → "Client page tab structure".

  ```tsx
  // The whole pattern: a pane is a place, so its setter pushes; the metric
  // inside it is a refinement, so its setter replaces.
  const pane = isValidPane(searchParams.get("journey")) ? searchParams.get("journey") : "body"
  const setPane = (next: Pane) => router.push(buildUrl(next), { scroll: false })
  ```

  Reference implementations: `app/(coach)/clients/[id]/page.tsx` (`?tab=`) and
  `components/clients/metrics/metrics-tab-content.tsx` (`?journey=`). The platform's own params and
  their single-owner contract are in `docs/ARCHITECTURE.md` → "Client page tab structure".

  **Anti-pattern — state mirroring.** Do not bridge a timing gap with local state: a `useState`
  shadowing a param, a precedence rule ("use the local value if set, else the URL"), and a
  `useEffect` to clear it. That is accidental complexity — synchronisation code written to clean up
  a split source of truth rather than to solve a product problem — and it drifts the moment either
  half is edited.

  ### No frame disagrees

  1. **One owner per surface.** A surface's open state and its content have one source: the address for anything navigable (a page, a tab, a pane, a record, a full-screen editor, the Training tab's apply tray), local state for a dialog or drawer that is not navigable. Never both.
  2. **One click, one commit.** Every change a click makes lands in ONE router call or ONE state update, never one of each, so nothing renders between them.
  3. **Derive, never remember.** No ref, state or effect exists to bridge a gap between two stores; a transient flash is a split source of truth by definition, and the fix is to delete the second store, never to hide the frame.
  4. **The previous screen stays until the next is ready.** Nothing renders null or a fallback for an in-flight param; the structural half is "Gate content, not structure" below.
  5. **Exit animations only on content the closing transition does not change.** A surface whose content derives from the address closes instantly: Radix re-renders a closing node from live state, and Framer's `AnimatePresence`, which freezes what leaves, is in the stack and not adopted for overlays (a later polish item). Enter animations and every existing dialog, sheet and drawer animation are unaffected.
  6. **The frame test, in every plan.** For each transition the plan lists the sources the click changes and every frame between the click and the settled screen; two sources, or a frame showing anything the settled screen does not, is rejected at plan time.

  **Progressive optimism.** Clean architecture first; optimise on evidence, not on speculation.

  1. **Derive (default).** Rely on the router. The UI updates when the URL commits, which is fast
     enough to read as instant for almost every transition.
  2. **Measure.** Only act on an observed lag.
  3. **Wrap with `useOptimistic`.** If instant feedback is genuinely needed, wrap the derived URL
     value — React owns the revert, so there is no clearing logic and no precedence rule. Do not
     re-introduce local state and do not restructure the components underneath.

  `useTransition` is not an alternative here: it defers the update and hands back `isPending`, so
  the value still changes when the URL commits. It buys a pending flag, not an early switch.

  ### Gate content, not structure

  A dependency that decides WHAT a surface shows must never decide WHETHER the
  structure around it exists. Rails, section sidebars, headers, tab lists, a
  card whose presence is already known — structural UI renders independently of
  anything it does not itself read: search params, fetched data, auth/profile
  resolution.

  - **Gate each piece on the narrowest thing it actually reads.** One gate — a
    `return null`, a Suspense boundary, an opacity/hidden wrapper — answering
    "may this exist?" with the answer to "what does it say?" is the defect.
    Split the questions: render the structure from what is already in hand, and
    represent the unresolved values as pending inside it.
  - **Suspense boundaries are as narrow as the true dependency.** In a
    statically prerendered route, `useSearchParams` bails rendering out to the
    nearest boundary and the prerendered HTML is the fallback — a page-wide
    boundary erases the page. Keep the reader in a leaf; everything structural
    stays outside it.
  - **Fallbacks preserve the structural shape.** Render the same frame in its
    pending state — nothing claimed, no guessed values — never `null`, so
    nothing shifts or flashes when the real state lands.

  Worked examples: `app/(coach)/clients/page.tsx` (the one `?view=` reader
  behind the boundary, `<RosterFrame view={null}>` as the fallback, held by
  `scripts/check-prerender.ts`) and `components/clients/client-detail-layout.tsx`
  (the frame never waits on the client record). The platform consequence is
  recorded in `docs/ARCHITECTURE.md` → "Coach route group".

  ### What NOT to use
  - Do not use TanStack Query / React Query (not installed).
  - Do not use Zustand (not installed).
  - Do not use axios (not installed).

  ## 8. Database

  ### Data modelling — normalise by default (MANDATORY)

  Relational database management is the default for every piece of stored data in this
  product, and normalisation is **reviewed and upkept** — on every new migration, and whenever
  a plan touches a table's shape. This is a §1 rule restated where the schema work happens.

  **The test, applied to every proposed column before it is written down:**

  | If the data… | then it is… |
  |---|---|
  | is referenced by any other row (an answer points at a question, a log at a habit) | its own table with a UUID `id` and a real foreign key — never a `questionId` inside JSON that nothing enforces |
  | is edited in place (rename, reword, reprice) | its own row, edited once — never a value copied into N parent rows that must all be rewritten |
  | is ordered, toggled, or assigned per owner | a join table carrying `position` / `enabled` / the owner FK — never an array whose index is the order |
  | is shared between owners (a template and a client, a coach and their clients) | one row referenced by both — copies only where `docs/ARCHITECTURE.md` says the library model is copy-based, and then the *join rows* are copied, not the entity |
  | will ever be counted, trended, or filtered on its own ("how did answers to Q3 change") | a table with an index on the column you will filter — a JSONB path scan is not a query plan |
  | is a fixed enum of a few keys with presence semantics | a join table `(parent_id, key)` with a `CHECK` on the key, or a `TEXT[]` **only** when the set is closed, small, and never referenced (the migration-149 `prescribed_fields` case — and that migration documents why) |

  **What JSONB is for here, and only here:** value-bags and snapshots that have no identity
  and are never addressed from outside — a set prescription (`set_specs`), a frozen
  submit-time snapshot (`period_snapshot`, `prescribed_session_snapshot`), a preference blob
  read whole (`reminder_preferences`), an AI payload read whole (`ai_insights`). The moment a
  key inside the blob needs a stable identity, an edit, or a reference, it is a table.

  **Denormalisation is allowed only when named and documented.** Submit-time snapshot columns
  (`check_ins.workouts_completed`), the per-event `training_events.calorie_surplus_percentage`
  and the copy-based library placement are sanctioned because
  `docs/ARCHITECTURE.md` says who the single writer is and what the copy is a copy *of*. A
  new one needs the same paragraph in the same commit. An undocumented denormalisation found
  in passing is recorded in `TECHNICAL-DEBT.md`, not used as precedent.

  **Multi-table writes are atomic.** A save that touches two or more tables goes through an
  RPC (`create_nutrition_plan_atomic`, `move_training_events_atomic` are the shape; optional
  params `DEFAULT NULL` + `COALESCE` in the body; `GRANT EXECUTE … TO service_role`), or the
  plan states exactly what is left inconsistent when the second write fails (§2 item 13).
  A normalised model that is written non-transactionally has traded one class of corruption
  for another.

  **In every plan, the data model is a decision, not a detail.** State the proposed tables,
  the alternatives considered (including the tempting column-on-the-parent one), and why the
  relational shape wins or — rarely — why it does not. A reviewer who sees a `JSONB` or an
  array column proposed for anything with identity should stop the plan there.

  ### Auth & data-access architecture (Shape B)

  CoachHub runs in a backend-mediated shape: the browser calls Next.js API routes, routes authenticate the user and verify ownership, routes call service functions scoped by `clientId`, service functions read/write through `supabaseAdmin`. Row-Level Security policies exist on most tables as a **safety net** for bugs in the route/service layers — not a second line of defense (if the route layer is broken, RLS does nothing because `service_role` bypasses it; see "RLS policies" below). This is a valid pattern for apps with a dedicated backend, multiple user audiences (coach + client), cross-user aggregation reads, and server-only integrations (OpenAI, Anthropic, Resend). See `TECHNICAL-DEBT.md → Auth Architecture Hygiene` for the rationale and for open hardening items.

  The consequence: the route layer **is** the security perimeter. Gaps in route-level auth are not caught by a second line of defense. Treat the route's auth chain and the service function's scoping parameter as non-optional.

  Auth bootstrap follows the same shape: the browser fetches its identity via `GET /api/auth/me` (`services/auth-profile-service.ts`); the browser anon-key client is `supabase.auth`-only and never reads `profiles`/`coaches`.

  #### Route-level auth chain (mandatory, in this order)

  Every authenticated API handler must execute these steps before any business logic. Order matters (§9 and §10 restate this; it is the same chain).

  1. **Rate limit** — `apiRateLimit` / `coachApiRateLimit` / `clientApiRateLimit` / `authRateLimit` / `checkInRateLimit` / `aiRateLimit` per the route's category. Two account-keyed tiers (`clientPerClientRateLimit`, `assistantRateLimit`) necessarily run *after* step 3 because they key on the resolved principal — see the sanctioned exceptions in §9.
  2. **CSRF** — `requireCSRFProtection(request)` on any mutating verb (POST / PUT / PATCH / DELETE).
  3. **Authentication** — `getAuthenticatedCoachId()` or `getAuthenticatedClientId()` from `lib/auth-helpers.ts`. 401 on null.
  4. **Authorization / IDOR** — verify the authed principal owns or has permission to access the resource. Coach routes verify `client.coachId === coachId`. Client routes verify the resource's `client_id === authedClientId`. Returns 403 (or 404 to avoid leaking existence) on mismatch.
  5. **Input validation** — zod `schema.safeParse(body)`. 400 on failure.
  6. **Business logic** — call the service function, passing the verified scope (e.g. `clientId`). Wrap in try/catch.

  Repeat per handler. Do NOT skip step 4 because step 3 succeeded — auth proves identity, not permission.

  #### Service layer contract

  - **Services use `supabaseAdmin`.** This is the default client for the service layer, not an exception. Import from `services/supabase-admin.ts`. Do NOT add a comment justifying its use — that was an artifact of the old rule and creates noise.
  - **Services that read or write user-owned data MUST accept an explicit scope parameter** (usually `clientId`, sometimes `coachId` for coach-owned resources). No service function reads client-owned data without being told whose data to read.
  - **Services MUST filter on the provided scope.** `.eq('client_id', clientId)` (or the equivalent join constraint for nested entities). A service that accepts `clientId` but doesn't filter on it is a data leak waiting to happen.
  - **Services trust their callers.** The route layer is responsible for proving that the `clientId` passed in is one the authed principal is allowed to access. Services do not re-verify (that would be the auth check moving into the wrong layer and creating circular dependencies).
  - **Never pass a user-provided `clientId` straight to a service.** The route takes `clientId` from the URL path (or request body) and MUST run an ownership check against the authed principal before handing it to a service. See the IDOR chain in step 4 above.
  - **Cross-user reads are legitimate.** Coach dashboard reads aggregate across all of a coach's clients; attention feed, library browsing, etc. These pass `coachId` to services that fan out; the service filters on `coach_id` rather than `client_id`. Same rule: caller-verified scope, service filters on it.

  #### When to use `createServerSupabaseClient()`

  Rarely. The existing usages run under the caller's JWT, so RLS applies to every query they make: before moving one onto `supabaseAdmin`, confirm the route itself filters by the authed principal, because `supabaseAdmin` drops RLS and leaves the route's own filter as the only one. If you think you need the session-scoped client, first confirm:

  - You genuinely need `auth.uid()` in-database (to satisfy an RLS policy that is doing real work), AND
  - The admin + explicit-scope pattern doesn't fit, AND
  - There is no cleaner way to pass the scope through.

  If all three are true, use it and add a one-line comment explaining why. Otherwise use `supabaseAdmin`.

  #### RLS policies

  - RLS is enabled on **every** table in `public` (verified against the live catalog by `npm run check:rls`). For the app's `supabaseAdmin` path it is a safety net, because service_role bypasses it. On the app's session-client reads (see "When to use `createServerSupabaseClient()`" above) it applies to every query, and for anyone hitting PostgREST directly with the browser-shipped anon key **it is the only perimeter**.
  - Do NOT write new app-code that relies on RLS to enforce access. If the route layer is broken, RLS under service_role does nothing (service_role bypasses RLS entirely — which is most of our DB traffic).
  - **When adding a new table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and write NO policies.** Deny-all is the default posture, because every service read and write goes through `supabaseAdmin`, which bypasses RLS — so a policy grants access that nothing in the app needs. Precedent: `108_create_audit_logs.sql:37`, and migrations 122/125/126. Only add a policy when a specific non-service_role caller provably needs the table, and scope it to the owner.
  - **A new table's privileges are set explicitly, in the migration — a REVOKE, then exactly the grants it needs.** Supabase's stock default privileges hand ALL on a new table to `anon`, `authenticated` and `service_role` the moment it exists, on both projects, whatever "Automatically expose new tables" says in Settings → API (probed on `client_phases` and `check_in_forms`, 2026-09-02; on 2026-09-14 every table created without a REVOKE still held the grant, on both projects). Left to the defaults, a table is reachable through PostgREST with the browser-shipped anon key and RLS as its only perimeter — silently, never as an error. So revoke first, then grant `service_role` what the service layer uses (ALL for an ordinary table; `SELECT, INSERT` for an append-only one), and `anon`/`authenticated` nothing unless a specific non-service_role caller provably needs the table, scoped by a policy. `158_client_measurements.sql` is the shape, its one client-scoped policy beside the grant.
    ```sql
    CREATE TABLE IF NOT EXISTS public.new_thing (...);
    ALTER TABLE IF EXISTS public.new_thing ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.new_thing FROM PUBLIC, anon, authenticated, service_role;
    GRANT ALL ON TABLE public.new_thing TO service_role;
    ```
    Put it in the migration, never in the dashboard — a grant made in Studio is invisible to source and drifts, which is how migration 125's `DROP POLICY` became a silent no-op. **Do not retrofit the tables that carry policies.** The 26 tables created before this rule that carry policies keep the stock `GRANT ALL … TO anon, authenticated`: eight of them (`coaches`, `clients`, `profiles`, `content_items`, `content_assignments`, `check_ins`, `nutrition_plans`, `nutrition_plan_daily_targets`) are read through the session client, so a blanket revoke would lock those readers out, and narrowing their grants is a per-table design, not a retrofit. A table with no policy is different: through the API only the service role can read or write it, so an `anon` or `authenticated` grant on it buys nothing and leaves RLS as its only perimeter, which `check:rls` cannot fully judge (§2 review, item 5).
  - **NEVER write `TO authenticated USING (true)`.** It is not "deny-by-default"; it is a platform-wide cross-tenant read and write. The anon key ships in the browser bundle and any logged-in user holds an `authenticated` JWT, so such a policy is directly exploitable via `/rest/v1/…`. This convention previously *prescribed* that shape; migrations 091 and 101 followed it and both had to be dropped in 125. See `TECHNICAL-DEBT.md → Known RLS Gaps`.
  - **Always add an explicit `TO` clause.** A policy with no `TO` defaults to `PUBLIC`, which includes `anon`. That is only safe if the qual references `auth.uid()` (NULL without a JWT ⇒ fails closed). A no-`TO` policy whose qual does not reference the caller — e.g. `USING (bucket_id = '…')` — is unauthenticated access; that exact shape exposed the private progress-photos bucket until migration 126.
  - Avoid nested-subquery policies that replicate the IDOR chain: they cost at scale for no benefit under service_role. If a table genuinely needs both coach- and client-side reads, write **one** policy with a single qual rather than two permissive ones — two permissive policies OR together, and a sublink under an `OR` never pulls up to a semi-join.
  - **Views need `WITH (security_invoker = on)`.** Postgres defaults a view to owner-rights, which launders past the RLS on its base tables. `daily_logs_full` (migration 056) shipped without it over the health-PII tables; `123` pins it.
  - **Never change a policy in the Supabase Studio SQL editor.** Drift is not theoretical here: it has silently renamed a policy (making a later `DROP POLICY IF EXISTS` a no-op) and silently added two anon-reachable ones that appeared in no migration. Verify every policy change against a fresh `npx supabase db dump --linked`, not against `db push` exiting 0.

  #### Audit logging (migration 108)

  - Security-relevant actions on client-owned data are recorded in an immutable, append-only `audit_logs` table for incident investigation (`services/audit-log-service.ts`, migration 108). Call `recordAuditEvent(...)` **fire-and-forget** (`void`-prefixed) AFTER a successful, already-authorized write — it records what the route already authorized; it never authorizes or blocks the request.
  - Pass a caller-verified `actorId` + `clientId`. Use `action` names from `AUDIT_ACTIONS` (`lib/constants.ts`); `metadata` is small, non-sensitive context only — never health PII. If you pass `request`, the helper hashes the IP (SHA-256 prefix), never the raw address.
  - When to log: the actions `AUDIT_ACTIONS` names — client invitation and activation, goals, measurements and metric entries, the intake metrics sync, nutrition and training plans, blocks and check-in forms. Failures go to Sentry, not the user.

  ### General
  - Migrations: Version controlled, never edit directly
  - Relations: Foreign keys with ON DELETE CASCADE, SET NULL, or RESTRICT. Use RESTRICT on parent tables that must not be hard-deleted (forces archival instead). **The event→plan FK is SET NULL** (`training_events.training_plan_id`, nullable since migration 113) so deleting a plan/template never destroys past/logged events — the events carry the date-specific truth (see "Events-as-SOT" below and `docs/ARCHITECTURE.md → Nutrition & Training Events`).
  - Indexes: On foreign keys, search fields, sort columns
  - Timestamps: created_at, updated_at on all tables. Exception: append-only tables whose value is never rewritten (`audit_logs`) intentionally skip updated_at - add a comment explaining why.

  ### Query result methods
  - `.single()` - Use when expecting exactly one row. Errors if zero or multiple rows returned.
  - `.maybeSingle()` - Use when expecting zero or one row. Returns `null` if no row found, no error.
  - No suffix - Returns an array of rows.

  ### Client read scaling (client-portal reads)
  These are the client app's scale contract; full rationale lives in `docs/CLIENT-PORTAL-REDESIGN.md`. They override the generic "copy the nearest pattern" guidance (§3) where existing code still uses offset.
  - **Bounded AND keyset by default.** Client list/history reads page on a cursor (today the check-in lists, on `(created_at, id)`), never `OFFSET` / `.range()`. Offset cost grows with how deep the client scrolls into a multi-year history; keyset stays flat. Add the matching keyset index *with* the query (e.g. `session_logs(client_id, completed_at DESC, id DESC)`).
    **This is not a client-portal-only rule, despite the heading.** Any paginated, time-ordered
    "load older" list follows it whoever reads it — the COACH's per-client check-in list
    (`GET /api/clients/[id]/check-ins`) pages on the same `(created_at, id)` cursor as the client's
    own. That list paged on `OFFSET` by early 2026, months before this rule was written on
    2026-05-22, and stayed there until 2026-08-30: a new rule does not reach code already written.
    An offset page is not merely slow: it addresses an absolute position in the list *as it is now*,
    so a row arriving at the head between two page fetches makes the pages repeat a row (a duplicate
    React key) or skip one, with nothing raising an error. Page *n*'s key derives from page *n-1*'s
    cursor on the client too — never re-derive it from an index.
  - **Sparse fieldsets.** Select only the columns a row needs — never `select('*')`, and never embed a dictionary inside a row list. Fetch dictionaries (e.g. the exercise catalog) once via their own endpoint; history rows carry IDs (`exercise_id`, with `performed_name` as fallback) and the client joins locally.
  - **Aggregate server-side.** Push GROUP BY / windowed aggregates into Postgres (RPCs) so payloads are render-ready and bounded by the result, not by history size. Native is a thin renderer.
  - **Keyset cursors are opaque.** Encode/decode via `lib/cursor.ts` (base64url of `{createdAt, id}`). Routes accept the cursor as a query param, decode it strictly (reject malformed base64/JSON, non-UUID `id`, or out-of-format timestamps with 400), and build the predicate with PostgREST `.or()` (`created_at.lt.<ts>,and(created_at.eq.<ts>,id.lt.<id>)`) ordered `created_at DESC, id DESC`. `isValidIsoTimestamp()` rejects any value outside the safe ISO charset (no commas/parens) to prevent PostgREST filter injection.
  - **Dictionaries sync via their own delta endpoint.** The exercise catalog is the canonical example: `GET /api/client/exercises/catalog?since=<ISO>` returns a sparse fieldset of rows with `updated_at` after `since` (omit `since` for a full resync). It is complete-by-construction past the ~1000-row PostgREST cap (pages internally on the tie-safe `(updated_at, id)` cursor); deletes are invisible to the delta, so a periodic full resync catches them.

  ### Soft deletes
  - User-created data uses soft delete, never hard delete
  - **is_active pattern**: Training sessions, exercises, and daily habits use `is_active = false`. Always filter by `.eq("is_active", true)` in read queries
  - **Status-based lifecycle**: Entities with richer states use a status column instead of is_active. The lifecycle is **not uniform across entities** — match the one already in place:
    - **Training plans** moved to **date-range coexistence** (events-as-SOT): many provenance `training_plans` rows coexist, there is **no `planned`/promotion concept**, and "active" is resolved **by date** (the row whose `[effective_from, effective_until]` covers today — both ends stored, migration 167), not `status='active'`. Placement is additive on the past and supersedes the future: the RPC caps every earlier live program at the day before the new start and archives one that started on the same day (it never ran a day of its own), and the service then removes the earlier programs' scheduled days from the start onward, logged days detached. Nothing before the new start is touched.
    - **Nutrition plans** are **date-ranged VERSIONS placed like training programs** (migration 166): N rows per client whose `[effective_from, effective_until]` windows never overlap, every one carrying an end (`effective_until` is NOT NULL). The end is resolved at save the way a training placement window is — the block covering the start, else the furthest live program's end, else eight weeks, the fallbacks capped at the day before the next block when the start is in a gap — capped at the next queued version's start (`resolveNutritionPlacementEnd`); the coach never types it. A save caps the predecessor at `new_start − 1` and replaces in place a version starting on the same day (`create_nutrition_plan_atomic`); a save dated before a queued version runs until the day before it and leaves it standing. "Active" resolves **BY DATE** (`coversDate` — the same window predicate as training), never by picking the newest `status='active'` row; a day no version covers has no target, and the meals still save there with no verdict — the food log holds what the client ate and nothing else (owner, 2026-09-11). `status` records coach acts only: **delete is a save of nothing from today** — the running version ends YESTERDAY and keeps its past, a queued version is archived, a finished one is untouched — and writes no day, because the days are computed from the versions, but removes the hand edits on the days it uncovers (`clearNutritionPlansForClient`, the training clear's shape; the block delete does the same for the versions laid in the block, and the block card's per-plan delete ends ONE version by id through the same retire path, `clearNutritionPlanById`); there is **no `planned` status** — planned/current/ended derive from dates. A day's target is computed from the covering version (see "Events-as-SOT" below); per-day coach edits are rows in `nutrition_day_edits` and never mint versions.
  - Unique constraints must account for inactive rows (check for inactive before inserting, reactivate if found)
  - Provide UI for viewing and reactivating inactive items where appropriate

  ### Client energy (BMR/TDEE)

  The client PROFILE owns metabolic identity. These are rules, not descriptions —
  each one is a bug that shipped and cost a session to unpick.

  - **BMR and TDEE are NEVER written separately.** One helper owns the pair:
    `recalculateClientEnergy()` (`services/client-energy-service.ts`) is the only
    writer of an UPDATE to `clients.bmr` / `clients.tdee`, and every UPDATE it issues
    carries both keys. Six uncoordinated writers used to exist and three wrote only
    half, which is how a profile came to state a TDEE derived from a BMR that no
    longer existed. `createClient`'s INSERT sets the pair once at row birth through
    the same pure calculator and is the one sanctioned exception — the invariant is
    one writer for *updates*. `services/client-energy-ownership.test.ts` enforces
    this and documents the carve-out beside the scan; do not widen the scan to
    inserts, and do not narrow the invariant.
  - **Formulas live once**, in the pure `services/client-energy-calc.ts` (Katch-McArdle
    when body fat is known, else Mifflin-St Jeor). That module must never import
    `supabaseAdmin`: the browser and the seed scripts both use it, and
    `npm run check:service-key` fails on a `"use client"` module reachable from
    `services/supabase-admin.ts` by value imports. TDEE derives from the **rounded**
    BMR so the stored pair is reproducible and agrees with the nutrition calculator's TDEE step.
  - **An override flag freezes exactly its own value**; the other half keeps
    auto-recomputing. A flag set over a NULL value is not a freeze and is recomputed.
  - **Activity level is a CLIENT fact.** It is set on the client profile (the Overview
    settings dialog) and read from `clients.work_activity_level`. **Nothing under
    `components/clients/nutrition/**` writes it** — a dropdown there gave activity two
    homes that disagreed, and made "regenerate a plan" the accidental way to update a
    client's TDEE. `nutrition_plans.work_activity_level` is a snapshot of the client's
    value at save, never an input.
  - **A weight change never touches a plan row.** Plans snapshot bmr/tdee at
    generation; only a regeneration inherits the then-current profile numbers.
  - **Never seed `work_activity_level` from the column DEFAULT.** `createClient` writes
    an explicit NULL so "never set" stays distinguishable from "the coach chose
    sedentary" — the default silently disabled the intake sync's null-guard and a
    client's questionnaire answer never reached their profile.

  ### Events-as-SOT on the training track; a computed day on the nutrition track

  Date-specific TRAINING targets live on **events** (`training_events`), one row per session per date. Plans and their slot rows (`training_sessions`) are **the placed program that generates events + provenance for analytics/reapply** — not the live read path for a given day, and never embedded via a live join to a deletable plan. Historical reads resolve from immutable snapshots (`session_logs`, `nutrition_logs`), never from re-layable events. When you add a date-specific training feature, write it onto the event, not the plan. **A NUTRITION day is computed, never stored**: the target on a date is resolved when asked from the version covering it (`nutrition_plans` — a window plus its weekday grid), the session on the date and the coach's per-day edit (`nutrition_day_edits`). No writer keeps days in sync — there is no cascade, sweep or regenerate — and a day table, a day-sync writer or a nutrition-day deletion floor must not be reintroduced. A version's grid is never edited in place once its first day has passed; that is what keeps a derived past stable, so a feature that adjusts a running plan's numbers mints a version. Full model: `docs/ARCHITECTURE.md → Nutrition & Training Events`.

  **Two things an events-SOT edit must not break:**
  - **Adherence math is its own decision.** On the coach's check-in surfaces a completion count has one source, `summariseSessions` (`lib/check-in/adherence.ts`), and `lib/check-in/adherence-ownership.test.ts` fails on a second definition — do not change adherence math under the guise of an events-SOT edit.
  - **Prescribed denormalization.** `training_events.calorie_surplus_percentage` is denormalized from the session so a nutrition day can read it per date; **every** training event-write path must keep populating it. One dropped write silently misprices that day: the day resolver falls back to the sessions' flat `estimated_calories`, zero when none is set, so the day is priced as a rest day while the TRAIN badge still renders.

  ### Training prescription model (migrations 119-121)

  - **`set_specs` JSONB is the prescription. `sets` / `reps_min` / `reps_max` are a maintained projection, never independent truth.** Never write the compact three directly. Every insert/update goes through `projectExerciseCompact` (`utils/exercise-set-specs.ts`), which writes `set_specs`/`video_url` verbatim and re-derives the compact trio via `compactFromSpecs` (clamped to the `training_exercises.sets` CHECK [1,20]). Clone sites splat the source row's columns instead — never re-derive on a copy. A write path that sets `sets` by hand silently corrupts the coach's programming, and no test will tell you.
  - **Read through `expandSetSpecs`, not the columns.** It returns authored specs when present and otherwise synthesizes N `working` specs from the compact columns, so every prescription yields per-set rows carrying a `set_type`. A reader that ignores `set_specs` sees a truthful but lossy summary — it loses warm-ups, AMRAP/drop/failure sets, per-set loads and per-set rest.
  - **Edits go through the shared kernel.** `applySetSpecEdit` (`utils/set-spec-edits.ts`) is the one pure editing path, used by both the builder hook and the assistant's server executors so they cannot drift. Its invariants are load-bearing: `MAX_SET_SPECS` 30, `MAX_WORKING_SETS` 20, never all-warmup, deleting the last set reverts `setSpecs` to `null` (never `[]`), and a no-op edit returns the same array reference so a blur can't silently materialize specs.
  - **Set type is coach-prescribed, never client-chosen.** `set_logs.set_type` is seeded from the prescription snapshot; the log schema accepts-but-ignores any client value. Analytics exclude `warmup` from every performance metric; the progression engine touches `working`-type sets only. **These two filters are deliberately different — don't unify them.**
  - **Every exercise sits in a group (migration 178).** A session is an ordered list of groups, a group an ordered list of exercises; a lone exercise is a straight-sets group of one. Every clone/serialize/placement path carries the groups exactly — each group's format, settings and place, each exercise's place in its group — through the one row builder per tier (`services/coach-library-helpers.ts`, `services/training-group-writes.ts`); a path that rebuilt groups by default would silently erase a coach's supersets. A new path that saves or copies exercises joins `services/exercise-groups-survival.test.ts`. **Group edits go through one pure module**, `components/clients/training/program-builder/program-builder-groups.ts`, shared by the builder's mutators and the assistant's ops so the two cannot drift, and three rules hold after every edit: a group of one is a plain exercise with nothing set; in a superset or circuit every exercise has exactly one set per round, so changing how many sets one has is a change to the group's rounds, never to that exercise alone; and a group stores no setting its format doesn't use. The write schemas refuse anything else. Full model: `docs/ARCHITECTURE.md` → "Groups".
  - **`is_warmup` is retired from builder authoring**: it is still rendered in the client tracker, but its last writer (the legacy calendar drawer's add-exercise dialog) was deleted with the drawer — it now only round-trips through the draft/clone/serialize/placement paths, and must keep doing so; add no new UI for it.
  - **Days are positional, not weekdays.** The builder authors a weeks × Day-1-7 grid; placement writes `day_of_week: null` and places the whole program once as a sequential date-walk keyed on `(week_index, order_index)`. Rest days are **real rows** (`is_rest = true`) that advance the slot position and emit no `training_event` — "empty === rest". A missing rest row collapses the week and slides every later date. Never reintroduce weekday-derived scheduling or a 7-day repeat assumption.
  - **`training_plans.saved_plan_id` is not a reliable back-link.** Apply-with-edits places `saved_plan_id = NULL`. Don't reason about "which template is this client on" from that column.
  - **One scheduled session per client per day** (migration 136 — launch scope, drop it when multi-session days ship). Enforced in two layers: a partial unique index on `training_events (client_id, date) WHERE status = 'scheduled'`, and a status-agnostic pre-check (`assertDateFree`, `services/training-event-occupancy.ts`) on the two single-date paths — move and the library-session drop. **Do not add a same-day guard keyed on `training_session_id`** — that was the original design and it silently stopped working the moment placement began cloning each day into its own session row, because no two events share a session id any more. Whole-program placement deliberately does NOT pre-check: it first deletes the scheduled events in the window it is about to fill, so a pre-check would reject the window it just vacated (the module's header says the same). It translates the index's `23505` instead, through `rethrowIfAnyDateOccupied` in the shared walk (`services/program-event-walk.ts`), because an early log the clear leaves behind, or a concurrent write, can still collide. The index is only the backstop, and it is not covered by the generated-event upserts' conflict arbiter, so every writer either pre-checks or translates (`rethrowIfDateOccupied` for a single date): a collision must reach a coach as a sentence, not as Postgres text. The layout RPC (`move_training_events_atomic`, migration 150 — N moves in one transaction, park-then-place) carries the equivalent pre-check in SQL (a non-moving scheduled event on any target raises `occupied:<date>`); its two callers — the client's week (`services/training-event-layout-service.ts`) and the coach's drag (`services/training-event-calendar-service.ts`), each with its own rules — run the status-agnostic check in TS before it and translate the index's `23505` through `rethrowIfAnyDateOccupied`. The plan editor's save (`edit_training_plan_atomic`, migration 175) keeps the scheduled event already on a day and replaces what it holds, so it needs no pre-check, and it treats the index's `23505` as the calendar having changed. The start-date move (`move_training_plan_atomic`, migration 177) checks every day its sessions land on inside the function, status-agnostic and with those days locked, parks and places them as the layout RPC does, and its service translates the index's `23505` through `rethrowIfAnyDateOccupied`. A new single-date writer calls `assertDateFree`; a new writer that clears a window first follows placement's shape.
  - **A logged day's prescription is frozen.** `assertSessionUnlogged` (same module) refuses a session-editing write when ANY linked `training_event` has left `status = 'scheduled'` — the one predicate for it: do not invent a second. It lives INSIDE `replaceSessionFull` so a future caller inherits it, runs AFTER it proves the session belongs to the client so a foreign id still 404s, and the tray's save route translates it to a 409 carrying its message. Rewriting the exercise rows under a logged day orphans the client's `exercise_logs`, and since `completion_quality` became server-derived it records a full workout as `partial`. Any new path that rewrites a placed session's exercises calls it.

  ### Migration awareness
  - Don't suggest schema changes that would break existing data
  - If adding a required column, it needs a default value
  - If renaming a column, everything that queries it breaks
  - JSONB columns: Supabase handles serialization automatically - never use `JSON.stringify()` on JSONB

  ### Migration workflow (MANDATORY)

  **Never paste schema SQL into the Supabase Studio SQL Editor.** The Studio SQL Editor is read-only in our mental model — fine for `SELECT` queries, ad-hoc investigation, debugging. Never `CREATE`, `ALTER`, `DROP`. Pasting schema SQL into the editor bypasses the `supabase_migrations.schema_migrations` tracking table and causes silent drift between the codebase and the live DB. Any schema change that reaches prod without a migration file in git is a bug.

  **The five-step workflow for every schema change:**

  1. Create a new migration file at `supabase/migrations/XXX_<short_description>.sql` with the next available number (never reuse, never skip, never edit existing migrations).
  2. Apply it via terminal: `npx supabase db push`.
  3. Regenerate types: `npx supabase gen types typescript --linked > types/database.ts`.
  4. Skim the `types/database.ts` diff — the changes should exactly correspond to your migration. Unexpected additions/removals are a red flag.
  5. Commit the migration file and regenerated types in the **same commit** so git history stays coherent.

  **A destructive change re-probes PROD first.** Before a `DROP COLUMN`, a backfill, a
  de-duplication, or anything else that cannot be undone by a follow-up migration, run the
  probe that justifies it **against prod**, not only against dev. A successful `db push`
  proves the migration applied; it proves nothing about whether the two databases agree, and
  both databases have drifted from the migration tree, in both directions: dumped on 2026-09-14,
  Dev carried a unique key on `coaches.user_id` and `TO authenticated` clauses on two `daily_logs`
  policies that no migration creates, and Prod carried a Supabase helper function Dev lacks. Dev is
  `aeaphsslctwcmebldrzx`, prod is `etezzztgafcotyahgijk`; `npx supabase db query --linked`
  gives password-free read access to whichever is linked. Row counts, "no client has X",
  "zero duplicates exist" and `pg_depend = 0` are **per-database facts** and do not travel.
  Schema-shape claims (an index exists, a column has no CHECK) usually do, but the cost of
  being wrong is asymmetric — an additive change that was unnecessary is noise, a destructive
  one that was unsafe is data loss.

  **Rules that keep this healthy:**
  - One file per change. Don't edit an existing migration to "add one more thing" — write a new file.
  - Never edit a migration file after `db push` has applied it. Once it's history, changes go in the next number.
  - Never skip or reuse migration numbers. 088 → 089 → 090. No `088_v2`, no going back.
  - `types/database.ts` is generated — never hand-edit it. If something looks wrong in that file, the bug is in the database schema, and the fix is a new migration.

  **Useful commands:**
  ```
  # Current state of the tracking table vs local migration files:
  npx supabase migration list --linked

  # Apply any pending migrations to the live DB:
  npx supabase db push

  # Regenerate types/database.ts from the live schema:
  npx supabase gen types typescript --linked > types/database.ts

  # Repair tracking table if drift appears (e.g. someone pasted into Studio):
  npx supabase migration repair --status applied <version> --linked
  ```

  **Docker requirement:** The daily workflow above does NOT need Docker — `db push` and `gen types` talk directly to the cloud DB via `--linked` credentials. Docker Desktop is only required for commands that spin up a local shadow DB (`supabase start`, `supabase db reset`, `supabase db diff`). Open Docker when you need those; keep it closed otherwise.

  ### Schema architecture
  Schema diagrams and table hierarchies are documented in **docs/ARCHITECTURE.md**; when JSONB is allowed is §8 "Data modelling" above. That file evolves with migrations. These coding rules stay stable.

  ## 9. Security
  - Auth: Check on every protected route/component
  - Middleware auth: Uses `getUser()` which validates JWT server-side, NOT `getSession()` (which only reads the cookie without verification, making it susceptible to tampered tokens)
  - Input sanitization: All user inputs
  - Rate limiting: **MANDATORY** - Every API route must include rate limiting as the first check
  - CSRF protection: **MANDATORY** - All mutating API routes (POST/PUT/PATCH/DELETE) must call `requireCSRFProtection(request)` from `lib/csrf-protection.ts` as the second check after rate limiting
  - Sensitive data: Never log passwords or tokens
  - File uploads: Validate the size, and the declared type against the file's own signature (`lib/upload-validation.ts`). The uploads are progress photos and content-library files

  ### Rate Limiting Requirements
  **ALL new API routes MUST implement rate limiting as the first operation in every handler function.** Two sanctioned shapes deviate in *ordering* (below); a route that limits after auth outside them is a defect, not a third shape. Tier assignment is a separate and worse story — read the next paragraph before "fixing" one.

  > **The limiter does not namespace by tier, so retiering a route is unpredictable.** `lib/rate-limit.ts` hardcodes `prefix: "ratelimit:api"` and keys on the bare IP; the config shapes only the sliding-window algorithm, never the key. So on the Redis path **every tier routed through the generic `rateLimit()` shares one counter per IP**, and which ceiling applies depends on which limiter instance ran last. (The in-memory fallback *does* namespace by `${clientId}:${maxRequests}:${windowMs}`, so the two paths disagree. `assistantRateLimit` sets its own prefix and is genuinely isolated.) The visible symptom of this is 15 `/api/clients/**` route files sitting on `apiRateLimit` where this section says `coachApiRateLimit` (re-counted 2026-08-30; it said 21) — but moving them is not a one-line fix, because it perturbs unrelated routes for the same IP. **Fix the key first, then the tiers.** Recorded in `TECHNICAL-DEBT.md`.

  > **Client-portal two-tier exception.** Client routes are keyed per *client identity*, but the client id isn't known until auth resolves. So client-portal routes run **two tiers**: a generous IP-keyed burst guard stays the mandatory *first* operation (DoS / carrier-NAT safe), and a tight **per-client** limit is applied immediately *after* `getAuthenticatedClientId()` resolves. This is one of the two sanctioned places a rate-limit check runs post-auth (the assistant, below, is the other); the first-operation rule still holds for the IP guard.

  > **Assistant single-tier deviation — described, not endorsed.** `/api/training/assistant` runs CSRF → auth → `assistantRateLimit(request, coachId)`, and unlike the client-portal exception it has **no IP-keyed first tier at all**. The limiter is coach-keyed with no IP fallback so IP rotation can't buy extra model spend, and the route does no work before the limit — the model call sits behind it. **The missing burst guard is logged as debt in `TECHNICAL-DEBT.md`, not a pattern to copy.** Do not replicate this shape on a route that reads or writes before limiting.

  #### Rate Limit Types:
  - `authRateLimit`: Auth/invitation routes (5 requests per 15 minutes)
  - `apiRateLimit`: General API endpoints (60 requests per minute)
  - `coachApiRateLimit`: Coach-side client routes (30 requests per 10 seconds, allows burst traffic)
  - `clientApiRateLimit`: Client portal routes (first tier) — a loose, abuse-only IP burst guard (~1000 req/10s) set above any plausible carrier-NAT aggregate. Paired with a tight **per-client** limit (`clientPerClientRateLimit`, 30 req/10s, keyed by client id) applied post-auth. The per-client tier composes on top of any first-tier override; it is never replaced by one.
  - `checkInRateLimit`: 30 requests per minute. No route uses it: the public check-in flow was removed with migration 142
  - `aiRateLimit`: One-shot AI endpoints (10 requests per minute) - prevents cost abuse
  - `assistantRateLimit`: The AI program assistant's chat turns (20 requests per 5 minutes, prefix `ratelimit:assistant`, always keyed by coach id). Its own tier because `aiRateLimit` is sized for one-shot generations and would 429 a coach mid-conversation; the wider window still caps runaway model spend. **Runs after auth**, not first, because it keys on the resolved coach id (the same sanctioned exception as the client-portal per-client tier).

  #### Required Pattern:
  ```typescript
  import { apiRateLimit } from "@/lib/rate-limit";

  export async function GET(request: NextRequest) {
    const rateLimitResult = await apiRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    // ... rest of handler logic
  }
  ```

  #### When to Use Each Type:
  - **authRateLimit**: `/api/invitations/*`. No app route serves login, signup or password reset: those call Supabase Auth from the browser. The one `/api/auth/*` route, `/api/auth/me`, is a per-app-load bootstrap GET for both roles, on `apiRateLimit` per the `/auth/callback` precedent
  - **coachApiRateLimit**: `/api/clients/*` (coach viewing/managing client data)
  - **clientApiRateLimit**: `/api/client/*` (client portal endpoints)
  - **checkInRateLimit**: none today (see above)
  - **aiRateLimit**: One-shot AI endpoints (check-in summaries)
  - **assistantRateLimit**: The program assistant's chat route (`/api/training/assistant`) — conversational, so it needs a wider window than `aiRateLimit`
  - **apiRateLimit**: All other routes (default choice)

  ## 10. API Design
  - RESTful routes
  - Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 404 (not found), 500 (server)
  - Response format: { success: bool, data: {}, error?: string }
  - Timestamps: ISO 8601 format
  - No version prefix in routes (use `/api/*` directly)

  ### API Route Middleware Ordering
  Every API handler must follow this exact sequence:
  1. Rate limiting (`apiRateLimit`, `coachApiRateLimit`, etc.)
  2. CSRF protection (`requireCSRFProtection`) - mutating methods only
  3. Authentication (`getAuthenticatedCoachId()` or `getAuthenticatedClientId()`)
  4. Authorization (ownership check - verify coach owns the client)
  5. Input validation (`schema.safeParse(body)`)
  6. Business logic (wrapped in try/catch)

  The only sanctioned reorderings are the account-keyed rate-limit tiers documented in §9 (client-portal per-client, and `/api/training/assistant`), where the limiter runs after step 3 because it keys on the resolved principal. Steps 2-6 keep their relative order everywhere. If you find a route that deviates, check §9 before "fixing" it.

  ### API changes cascade
  - If you change an API response shape, check every file that consumes that endpoint.
  - If you add a required field, update every caller.
  - If you add an export to a module, check if tests mock that module and update the mock.

  ### User-facing errors
  - Never show raw database errors to users (e.g. "duplicate key value violates unique constraint").
  - Catch known error patterns and return friendly messages (e.g. "A habit with this name already exists").

  ## 11. AI Services

  **Two providers.** OpenAI serves the one-shot, single-call features. Anthropic serves the program assistant, which is an agentic tool loop rather than a single call — a different shape with different rules, so don't generalise one section onto the other.

  ### OpenAI (one-shot generation + analysis)
  - **`gpt-4o`**: Check-in AI summaries (`services/ai-service.ts`) - higher quality reasoning for nuanced client feedback
  - Check-in summaries are the **only** OpenAI feature in the product. Everything else AI-facing is the Anthropic assistant below.
  - Every OpenAI call must specify an explicit timeout on the call (not the client): 25s for check-in summaries.
  - Env: `OPENAI_API_KEY`.

  ### Anthropic (the program assistant — `services/assistant/`)
  - Default **`claude-opus-4-8`**, overridable per deployment. The workload is structured tool selection against a prescriptive prompt, NOT open-ended reasoning, so cheaper tiers are viable and have been measured at quality parity — treat the model as a cost knob, not an architectural decision.
  - Env: `ANTHROPIC_API_KEY` (**required** — the route returns a clear 500 without it), plus optional `ASSISTANT_MODEL`, `ASSISTANT_EFFORT` (`low|medium|high|xhigh|max`), `ASSISTANT_THINKING` (`off`).
  - **Request params are built per model** (`draft-agent-service.ts`). Older tiers reject `output_config.effort` outright and predate adaptive thinking; Fable/Mythos reject an explicit `thinking: disabled`. An unsupported field is a hard 400, not an ignored hint — never send them unconditionally.
  - Timeout is on the SDK client (240s), not per call: an agentic turn is many sequential model round trips, so per-call budgets like OpenAI's don't apply.
  - Every turn logs `assistant_turn` telemetry (iterations, duration, tokens, `cacheEngaged`, estimated cost). Read it before optimising — the loop is otherwise invisible, and a slow turn may be many cheap iterations rather than one expensive one.

  ### Rate Limiting
  One-shot AI endpoints use `aiRateLimit` (10 req/min). The assistant's chat route uses `assistantRateLimit` (20 req / 5 min, coach-keyed) — a conversation would trip the one-shot tier mid-flow.

  ### Cost
  The assistant bills per coach message, so cost scales with usage rather than headcount. Per-coach spend quotas are still unbuilt (see `TECHNICAL-DEBT.md`) — until they exist the ceiling is the rate limit, not a budget.

  ## 12. Error Handling
  - All API routes: try-catch with proper error codes
  - User-facing errors: Toast notifications with plain language
  - Server-side errors: Use `captureApiError(error, context)` from `lib/error-handler.ts` to log and send to Sentry
  - Client-side errors: Wrap error-prone UI sections with `<ErrorBoundary>` from `components/ui/error-boundary.tsx`
  - Sentry config: `instrumentation-client.ts` (browser — 10% traces, `sendDefaultPii: false`, `scrubHealthData` beforeSend/beforeBreadcrumb, replay with `maskAllText`/`blockAllMedia`), `sentry.server.config.ts` and `sentry.edge.config.ts` (10% traces + `scrubHealthData`). The browser init lives in `instrumentation-client.ts` because under Next 16/Turbopack the legacy `sentry.client.config.ts` no longer loads — there must be exactly one client init.
  - Validation: Zod schemas in `lib/validations/` for all inputs/API payloads. Use `.refine()` for cross-field validation.
  - Database operations: Transaction rollbacks on failure
  - No empty catch blocks - always log the error or surface it to the user

  ## 13. Testing
  - Unit tests: All service functions and utilities
  - Integration tests: Critical flows (auth)
  - API tests: All endpoints with success/error cases
  - Run tests before commits

  ### Commit-ready checklist
  Before saying "ready to commit", ALL of these must pass:
  1. `npx tsc --noEmit` - no TypeScript errors
  2. `npx eslint .` - no lint errors (it catches floating and misused promises and type issues). A `console.log` is only a warning (§18) and does not fail it, so also `grep -rn "console.log" [changed files]`.
  3. `npx vitest run` - all tests pass
  4. `npm run check:labels` - shared tokens hold: mono = numbers only (no raw `font-mono-display` or hand-rolled `uppercase tracking-` outside the token modules), and no hand-rolled segmented control (clause 3 — every pane/period/filter switcher imports `<SegmentedControl>`). See `docs/newdesignsystem.md` → Typography and → Segmented control
  5. `grep -rn "as any" [changed files]` - no type escapes
  6. `grep -rn "TODO\|FIXME\|HACK\|DEBUG" [changed files]` - no leftover markers. This covers markers **introduced by the change**. A pre-existing marker in a region you did not touch is *reported in the session's STATUS block* and left alone — deleting a comment to make a grep pass is the band-aid §1 forbids, and it destroys a note someone left deliberately.
  7. **§2 "Security, load & performance review"** - if any of its triggers fired (new migration, new
     route, changed auth, new write path, completed plan session, ~≥5 files touching data flow), the
     review has been run and reported. Not applicable is a valid answer; skipping silently is not.
  8. `npm run build` - when the change touches routing, shells, a page's Suspense structure or anything
     else that could alter prerendering. The build chains `npm run check:prerender`, which fails if a
     statically prerendered coach page loses its structural chrome or `/clients`'s prerender claims a
     view (ARCHITECTURE → "Coach route group"). Not triggered by ordinary component/data changes.
  9. `npx knip` - exits clean. Vendored `components/ui/**`, the generated `types/database.ts` and the packages imported only from CSS are configured away in `knip.json`, so anything the report lists is the sweep's work list, not noise to read past.

  ## 14. Performance
  - Database queries: Indexes on foreign keys, frequently queried fields. Index *with* the query — add the keyset index alongside the read it serves (see §8 "Client read scaling").
  - API responses: <200ms target. Client list/history reads are **keyset-paginated and bounded by default** (§8), not offset.
  - Images: Optimize/compress before upload, use WebP
  - Caching: Redis (Upstash) for rate limiting and the 60-second `user_id → client_id` auth-resolution cache (`lib/auth-cache.ts`). Any other cache needs an explicit request (§2 "Scope discipline").
  - Lazy loading / infinite scroll: a **web-render** concern. The client web app is a throwaway test harness (the real client is React Native), so web-render perf — lazy-mount, memoization, virtualization, chart animations — is explicitly **out of scope** for the client portal; invest scale work in the data/API/DB layer instead. (Coach-side web perf is unaffected by this note.)

  ## 15. Documentation
  - API endpoints: Request/response examples, error codes
  - Complex functions: JSDoc with params, returns, examples
  - Setup: **`.env.example` does not exist in this repo** (only `.env.local`). Until someone creates it, a new env var is documented in the section of this file that owns the feature (AI keys in §11) plus a comment at its read site.
  - README: Local setup in <5 steps

  ## 16. References
  - **docs/ARCHITECTURE.md**: Database schema diagrams and table hierarchies, as built. Evolves with migrations - update when shipping schema changes.
  - **docs/CLIENT-PORTAL-REDESIGN.md** + **docs/CLIENT-PORTAL-EXECUTION-PLAN.md**: The day-centric, event-driven client portal. These are the source of truth for any client-portal work. Read both before modifying anything under `app/client/**` or `components/client-portal/**`.
  - **`docs/newdesignsystem.md`**: Visual patterns, colour tokens, spacing, typography. The authoritative source for visual tokens.
  - **TECHNICAL-DEBT.md**: Known gaps between conventions and current implementation.

  ## 18. ESLint Configuration
  Uses flat config (`eslint.config.mjs`) with TypeScript ESLint type-checked rules.

  ### Error-level rules (must fix)
  - `no-floating-promises` - unhandled async calls cause silent failures
  - `no-misused-promises` - async functions in non-async contexts (allows async onClick)
  - `await-thenable` - awaiting non-Promise values
  - `require-await` - async functions that don't await

  ### Warn-level rules
  - `no-explicit-any` - use proper types instead
  - `no-unused-vars` - ignores `_`-prefixed variables
  - `no-console` - allows `console.warn`, `console.error`, `console.info`, `console.debug`

  ### File-specific overrides
  - Components, pages, hooks, contexts: `no-floating-promises` downgraded to warn (useEffect fire-and-forget pattern is intentional when try/catch is inside)
  - Test files: `no-explicit-any` and `no-console` disabled

  ## 19. Configuration
  - .env files: .env.local
  - Required vars: there is no `.env.example` to document them in - see §15. The code reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` with the optional `ASSISTANT_MODEL` / `ASSISTANT_EFFORT` / `ASSISTANT_THINKING` overrides, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, and `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT`. If you create `.env.example`, backfill it from those.
  - Secrets: Never in code, use vault/secrets manager for prod
  ## 20. Units

  **Storage is canonical. Every weight is KILOGRAMS, every length is CENTIMETRES.**
  No per-row unit tags, no exceptions. The `weight_unit` / `height_unit` /
  `measurement_unit` columns are gone (migrations 140-141).

  **The preference belongs to the VIEWER, never to the record.** A coach has
  their own (`coaches.unit_preference`), a client has theirs
  (`clients.unit_preference`), and neither can change the other's. A metric coach
  and an imperial client work on the same rows and each see their own unit. Both
  default to `'metric'`. Anything that writes a unit onto someone else's account
  is a bug, not a feature — that is what the nutrition drawer's toggle did.

  **Convert only at the presentation boundary.** Nothing between the database and
  the render layer knows about pounds or inches. API responses carry kg/cm.

  ### Reading a value

  Every unit-bearing number renders through `utils/unit-conversions.ts` with the
  viewer's preference from `useUnits()` (client components) or
  `getViewerUnitPreference(request)` (server-rendered human-readable text only —
  AI prompts and calculator warnings). **No unit literal belongs in JSX.** If you
  are typing `"kg"` or `"lbs"` into markup, you are hardcoding someone else's
  assumption.

  | Value | Helper | Why |
  |---|---|---|
  | Barbell load — prescribed, logged, PR, e1RM, volume | `formatLoad` | Snaps to a loadable increment |
  | Body weight, goal weight, weight change | `formatWeight` | Converts freely, never snaps |
  | Girths (waist, hips, chest, arms, thighs) | `formatLength` | Decimal inches are correct here |
  | Height | `formatHeight` | Imperial height is composite — `5'11"`, never `71 in` |

  **Why `formatLoad` snaps and `formatWeight` does not.** 82.3 kg and 181.4 lbs
  are both meaningful body weights. A barbell is not: convert a prescribed 100 kg
  faithfully and an imperial gym reads 220.5 lbs, which cannot be loaded. A
  precise-looking unloadable number is worse than no conversion, so an imperial
  viewer gets the nearest 2.5 lb. Metric is the IDENTITY path and is pass-through
  — snapping there would not round a conversion artefact, it would rewrite stored
  data at the display layer (a logged 47 kg rendering as 47.5). Never restore a
  metric snap.

  ### Writing a value

  Forms collect in the viewer's unit and convert on submit via
  `parseWeightToKg` / `parseLengthToCm` / `parseHeightToCm`. Use
  `hooks/use-unit-inputs.ts` (`useCanonicalInput`, `useHeightInput`) rather than
  hand-rolling it — it owns three things that are easy to get wrong:

  1. **An untouched field must not write.** Display rounding is lossy: 178 cm
     seeds an imperial viewer as 5'10" and parses back to 177.8; 100 kg seeds as
     "220.5" and parses back to 100.017. A form that re-parses whatever is in the
     box rewrites values nobody edited, on EVERY save, because the box is
     pre-populated. Guard by comparing the SEEDED STRING, not an epsilon — only
     that makes a focus-through an exact no-op. (Same rule, same reason, as
     `program-builder/commit-input.ts` for prescribed loads.)
  2. **A unit flip re-renders the value, it does not reinterpret the digits.**
     Someone who types 180 cm and switches to imperial means 5'11", not 180 in.
  3. **Bounds describe STORAGE.** Validate the CONVERTED value. `WEIGHT_KG_MIN` /
     `WEIGHT_KG_MAX` / `GIRTH_TORSO_CM_MAX` / `GIRTH_LIMB_CM_MAX` / `LOAD_KG_MAX`
     live in `lib/constants.ts`; never write the number inline.

  **Editable load inputs are the exception to the table above: they seed from an
  UNSNAPPED conversion** (`displayLoad`, not `formatLoad`) behind a field-level
  dirty guard. Seeding an editor from `formatLoad` round-trips the snap into
  `set_specs` — an imperial coach opens a 100 kg session, sees 220, tabs past
  without editing, and stores 99.79 kg. Row-level guards are not enough; a row is
  dirty the moment its reps change.

  ### Wire tags

  A payload field naming its own unit is a legacy shape. Two survive, both for a
  non-web client (React Native) that logs in its own unit:
  `logTrainingEventSchema`'s per-exercise `weightUnit` (`exercises[].weightUnit`) and the check-in schema's
  `weightUnit`/`measurementUnit`. **Both are REQUIRED alongside the value they
  describe**, and that requiredness is what makes them safe — an optional tag
  needs a fallback, and a fallback silently decides the unit for a payload that
  never stated one. That is exactly how pounds got stored as kilograms. Reject an
  untagged value; never guess it. Do not add a third tag.
