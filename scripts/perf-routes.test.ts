import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { BASELINES, overBudget, PERF_ROUTES } from "./perf-routes";

/**
 * The request budgets cover every handler under these trees (CONVENTIONS §14
 * "Request budgets"), so scripts/perf-routes.ts holds a row for each: a route
 * added without one fails here, and so does a row whose handler is gone.
 */
const ROOT = join(__dirname, "..");
const TREES = ["app/api/clients", "app/api/client", "app/api/check-in", "app/api/check-ins", "app/api/training", "app/api/content"];
const EXPORTED_METHOD = /^export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/** "GET /api/clients/[id]/notes" for each method each route file exports. */
function handlers(): string[] {
  return TREES.flatMap((tree) =>
    routeFiles(join(ROOT, tree)).flatMap((file) => {
      const path = `/${relative(join(ROOT, "app"), file).replace(/\/route\.ts$/, "")}`;
      return [...readFileSync(file, "utf8").matchAll(EXPORTED_METHOD)].map(([, method]) => `${method} ${path}`);
    })
  );
}

describe("scripts/perf-routes.ts", () => {
  it("has a row for every handler the budgets cover, and none for a handler that is gone", () => {
    const rows = new Set(PERF_ROUTES.map((route) => `${route.method} ${route.path}`));
    expect([...rows].sort()).toEqual(handlers().sort());
  });

  it("keys each row once", () => {
    const keys = PERF_ROUTES.map((route) => route.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("fills every [param] of a read's path from the fixture", () => {
    for (const route of PERF_ROUTES) {
      if (route.method !== "GET" || route.unmeasured) continue;
      const params = [...route.path.matchAll(/\[(\w+)\]/g)].map(([, name]) => name);
      expect(params.filter((name) => !(name in route.params)), route.key).toEqual([]);
    }
  });

  it("holds a baseline only for a read perf-count requests", () => {
    const measured = new Set(PERF_ROUTES.filter((route) => route.method === "GET" && !route.unmeasured).map((route) => route.key));
    expect(Object.keys(BASELINES).filter((key) => !measured.has(key))).toEqual([]);
  });
});

describe("a read's budget", () => {
  const measured = { calls: 6, serial: 3, auth: 5, ms: 900, bytes: 50_000, status: 200 };
  const budget = { calls: 6, serial: 3, bytes: 50_000 };

  it("holds at its limits", () => {
    expect(overBudget(measured, budget)).toEqual([]);
  });

  it("says what puts a read over: its calls, the run of them, its body", () => {
    expect(overBudget({ ...measured, calls: 9, serial: 5, bytes: 210_300 }, budget)).toEqual(["9 calls > 6", "5 in a row > 3", "210.3 kB > 50.0 kB"]);
  });

  it("gives a whole program no size budget", () => {
    expect(overBudget({ ...measured, bytes: 400_000 }, { ...budget, bytes: null })).toEqual([]);
  });
});
