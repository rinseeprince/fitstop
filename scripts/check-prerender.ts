/**
 * Prerendered-chrome gate (chained to `npm run build`).
 *
 * The invariant (ARCHITECTURE → "Coach route group"): every statically
 * prerendered coach page carries its structural chrome — the rail its shell
 * mounts — in the built HTML, before any JavaScript runs; and /clients, which
 * prerenders as its own Suspense fallback (RosterFrame with view={null}),
 * must claim no view while doing so.
 *
 * No unit test can see this. Static prerendering happens inside `next build`,
 * not in jsdom, and the regression that recreates the blank page — a
 * useSearchParams call outside RosterWithParams, "fixed" by widening the
 * Suspense boundary — passes tsc, eslint and vitest. This gate reads what the
 * build actually emitted, so it runs where the artifact is made: package.json
 * chains it to `npm run build`, which also means it is never reading stale
 * output there. Standalone (`npm run check:prerender`) is valid only straight
 * after a build.
 *
 * Markers are derived from lib/navigation and lib/roster-views, not spelled
 * here, so a renamed nav item or roster view follows automatically.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { navigation } from "../lib/navigation";
import { ROSTER_VIEWS, rosterViewNavLabel } from "../lib/roster-views";

const APP = join(process.cwd(), ".next", "server", "app");
const MANIFEST = join(process.cwd(), ".next", "prerender-manifest.json");

// The full rail shows visible labels; the collapsed strip names its icon-only
// links through `title`. Either set appearing in full is that rail's presence.
const FULL_RAIL = navigation.map((item) => `>${item.name}<`);
const STRIP = navigation.map((item) => `title="${item.name}"`);

type PageSpec = {
  route: string;
  file: string;
  mustContain: string[];
  mustNotContain?: string[];
};

const PAGES: PageSpec[] = [
  { route: "/dashboard", file: "dashboard.html", mustContain: FULL_RAIL },
  { route: "/dashboard/content", file: "dashboard/content.html", mustContain: FULL_RAIL },
  { route: "/crm", file: "crm.html", mustContain: FULL_RAIL },
  { route: "/automation", file: "automation.html", mustContain: FULL_RAIL },
  { route: "/settings", file: "settings.html", mustContain: FULL_RAIL },
  { route: "/dashboard/programs", file: "dashboard/programs.html", mustContain: STRIP },
  {
    // The one route whose chrome is request-dependent (?view= decides its
    // title and highlight), so its prerender is the Suspense fallback:
    // RosterFrame with view={null}. Frame present, nothing claimed —
    // aria-current in this file means the fallback guessed a view.
    route: "/clients",
    file: "clients.html",
    mustContain: [
      ...STRIP,
      ...ROSTER_VIEWS.map((view) => `>${rosterViewNavLabel(view.value)}<`),
      'role="status"',
      ">Clients</h1>",
    ],
    mustNotContain: ["aria-current"],
  },
  {
    // The reverse direction: rails are mounted only by coach shells, so a
    // public page's prerender must carry neither variant.
    route: "/login",
    file: "login.html",
    mustContain: [],
    mustNotContain: [">Dashboard<", 'title="Dashboard"'],
  },
];
// Not listed on purpose: /dashboard/programs/exercises, …/sessions and
// /dashboard/training-library are server redirects with no surface, and the
// dynamic routes (/clients/[id], /dashboard/programs/[savedPlanId]) emit no
// build-time HTML to inspect.

if (!existsSync(MANIFEST)) {
  console.error(
    "check:prerender: .next/prerender-manifest.json is missing — this gate reads build output; run `npm run build` (which chains it).",
  );
  process.exit(1);
}

const prerendered = new Set(
  Object.keys(JSON.parse(readFileSync(MANIFEST, "utf8")).routes as Record<string, unknown>),
);

const errors: string[] = [];

for (const page of PAGES) {
  if (!prerendered.has(page.route)) {
    errors.push(
      `${page.route} is no longer statically prerendered (absent from prerender-manifest routes).`,
    );
    continue;
  }
  const path = join(APP, page.file);
  if (!existsSync(path)) {
    errors.push(`${page.route}: expected ${page.file} under .next/server/app — not found.`);
    continue;
  }
  const html = readFileSync(path, "utf8");
  for (const marker of page.mustContain) {
    if (!html.includes(marker)) {
      errors.push(
        `${page.route}: prerendered HTML is missing ${JSON.stringify(marker)} — structural chrome must not wait for JavaScript.`,
      );
    }
  }
  for (const marker of page.mustNotContain ?? []) {
    if (html.includes(marker)) {
      errors.push(
        `${page.route}: prerendered HTML contains ${JSON.stringify(marker)}, which this page's prerender must never claim.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`check:prerender — ${errors.length} violation(s):\n`);
  for (const error of errors) console.error(`  • ${error}`);
  console.error(
    '\nLikely cause: a widened Suspense boundary or a gate on the chrome. See ARCHITECTURE → "Coach route group" and app/(coach)/clients/page.tsx.',
  );
  process.exit(1);
}

console.info(
  `OK — ${PAGES.length} prerendered pages carry their chrome; /clients claims no view.`,
);
