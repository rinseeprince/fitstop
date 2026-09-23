import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The Journey's metric panes read their series from the two series routes —
 * the measurement log's (`measurement-series`) and the client's daily log's
 * (`wellness-series`) — and from nothing else. A pane that pages the
 * check-in list or reads the coach's entries for a series draws a second
 * answer to "how has this client been" beside the one the logs give.
 *
 * In the shape of `lib/measurements/baseline-ownership.test.ts`: nothing
 * under `components/clients/metrics/**` imports the check-in list's hooks or
 * names the check-in list route, and the entries route is named only by the
 * one writer that POSTs to it.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SCAN = "components/clients/metrics";

// The Log-measurement save: the entries route's one caller, and only a POST.
const ENTRY_WRITERS = new Set<string>(["components/clients/metrics/hooks/use-log-measurement.ts"]);

const CHECK_IN_LIST_HOOKS = /from\s+["']@\/hooks\/use-check-in-data["']/g;
const CHECK_IN_LIST_ROUTE = /\/api\/clients\/[^\n]*\/check-ins/g;
const ENTRIES_ROUTE = /\/api\/clients\/[^\n]*\/metric-entries/g;

function filesUnder(target: string): string[] {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(join(target, entry)));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Comments explain the rule and must not trip it.
const stripComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const sources = () =>
  filesUnder(SCAN).map((file) => ({
    rel: relative(ROOT, file),
    src: stripComments(readFileSync(file, "utf8")),
  }));

describe("the Journey's panes read their series routes, and nothing else for a series", () => {
  it("no file reads the client's check-in list", () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      for (const match of [...src.matchAll(CHECK_IN_LIST_HOOKS), ...src.matchAll(CHECK_IN_LIST_ROUTE)]) {
        offenders.push(`${rel} — ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the entries route is named only by the Log-measurement save, and only to POST", () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      if (ENTRY_WRITERS.has(rel)) continue;
      for (const match of src.matchAll(ENTRIES_ROUTE)) offenders.push(`${rel} — ${match[0]}`);
    }
    expect(offenders).toEqual([]);

    for (const writer of ENTRY_WRITERS) {
      const src = stripComments(readFileSync(join(ROOT, writer), "utf8"));
      expect(src.match(ENTRIES_ROUTE)).toHaveLength(1);
      expect(src).toMatch(/fetch\(`\/api\/clients\/\$\{clientId\}\/metric-entries`, \{\s*method: "POST"/);
    }
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    expect(filesUnder(SCAN).length).toBeGreaterThan(25);
  });
});
