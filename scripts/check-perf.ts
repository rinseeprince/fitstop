/**
 * The request-rule gate (CONVENTIONS §8 "The route resolves the request's
 * client once" and §14 "Performance"). Three rules read the tree, each a
 * ratchet against scripts/check-perf-baseline.json: a file may hold no more
 * violations of a rule than the baseline gives it, a file the baseline does
 * not name holds none, and fixing one lets `--write` lower the baseline.
 *
 *   npx tsx scripts/check-perf.ts            (or: npm run check:perf)
 *   npx tsx scripts/check-perf.ts --write    (or: npm run check:perf -- --write)
 *
 *   A. A whole-row read: `select("*")`, `select('*')` or a template starting
 *      with `*`, or a select list held in a constant that starts with `*`,
 *      under services/** or app/api/**, beyond the count
 *      scripts/check-perf-allowlist.ts sanctions for the file.
 *   B. A service resolving a client's context: getClientTodayString,
 *      getCoachTodayString, getClientWeekAnchor or getClientById imported
 *      under services/** by any module but its own.
 *   C. A history read whole and sliced: `.slice(offset…)` / `.slice(from…)`,
 *      or `fetchAllPages(`, under app/api/**.
 *
 * Comments are read as prose, never as code. Rule E, the budgets of §14's
 * table, is `npx tsx scripts/perf-count.ts --enforce`: it needs the app
 * running against DEV.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { WHOLE_ROW_SELECTS, type WholeRowSelect } from "./check-perf-allowlist";

export type PerfRule = "A" | "B" | "C";

export type PerfViolation = { rule: PerfRule; file: string; line: number; text: string };

/** Per rule, per file: how many violations the file holds. */
export type PerfCounts = Record<PerfRule, Record<string, number>>;

const RULES: readonly PerfRule[] = ["A", "B", "C"];

export const BASELINE_FILE = "scripts/check-perf-baseline.json";

/** The trees each rule reads (repo-relative). */
const RULE_ROOTS: Record<PerfRule, readonly string[]> = {
  A: ["services", "app/api"],
  B: ["services"],
  C: ["app/api"],
};

/** Rule B's resolvers, each with its own module: the one file under services/** that uses it without importing it. */
export const CONTEXT_RESOLVERS: Readonly<Record<string, string>> = {
  getClientTodayString: "services/today-service.ts",
  getCoachTodayString: "services/today-service.ts",
  getClientWeekAnchor: "services/check-in-week-service.ts",
  getClientById: "services/client-service.ts",
};

// Each pattern reads across line breaks: a select list may open on the line after `select(`.
const RULE_PATTERNS: Record<"A" | "C", readonly RegExp[]> = {
  A: [/\bselect\s*\(\s*["'`]\*/g, /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*["'`]\*/g],
  C: [/\.slice\s*\(\s*(?:offset|from)\b/g, /\bfetchAllPages\s*\(/g],
};
const NAMED_IMPORT = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g;

/**
 * The source with its comments removed, line for line, so line numbers still
 * point at the code. Strings are kept whole: a `//` inside one (a URL) is not
 * a comment, and a template string runs on across lines.
 */
function codeOnly(content: string): string[] {
  let inBlock = false;
  let quote: string | null = null;
  return content.split("\n").map((line) => {
    let out = "";
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (inBlock) {
        if (char === "*" && next === "/") {
          inBlock = false;
          i += 1;
        }
      } else if (quote) {
        out += char;
        if (char === "\\" && next !== undefined) {
          out += next;
          i += 1;
        } else if (char === quote) {
          quote = null;
        }
      } else if (char === "/" && next === "*") {
        inBlock = true;
        i += 1;
      } else if (char === "/" && next === "/") {
        break;
      } else {
        if (char === '"' || char === "'" || char === "`") quote = char;
        out += char;
      }
    }
    // A quoted string ends with its line; only a template runs on.
    if (quote !== "`") quote = null;
    return out;
  });
}

/** The names an import declaration binds from what it imports, `as` renames read by their imported name. */
function importedNames(code: string): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  for (const match of code.matchAll(NAMED_IMPORT)) {
    const line = code.slice(0, match.index).split("\n").length;
    for (const binding of match[1].split(",")) {
      const name = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (name) found.push({ name, line });
    }
  }
  return found;
}

/** Every violation of the three rules in one file. Pure, so each rule is testable without the tree. */
export function findPerfViolations(file: string, content: string): PerfViolation[] {
  const lines = codeOnly(content);
  const code = lines.join("\n");
  const inRoots = (rule: PerfRule) => RULE_ROOTS[rule].some((root) => file.startsWith(`${root}/`));
  const lineOf = (index: number) => code.slice(0, index).split("\n").length;
  const violations: PerfViolation[] = [];

  for (const rule of ["A", "C"] as const) {
    if (!inRoots(rule)) continue;
    for (const pattern of RULE_PATTERNS[rule]) {
      for (const match of code.matchAll(pattern)) {
        const line = lineOf(match.index);
        violations.push({ rule, file, line, text: lines[line - 1].trim() });
      }
    }
  }

  if (inRoots("B")) {
    for (const { name, line } of importedNames(code)) {
      const home = CONTEXT_RESOLVERS[name];
      if (home && home !== file) violations.push({ rule: "B", file, line, text: lines[line - 1].trim() });
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

/** Per rule and file, the violations a file holds beyond what the allowlist sanctions for it (rule A). */
export function countViolations(violations: readonly PerfViolation[], allowlist: readonly WholeRowSelect[] = WHOLE_ROW_SELECTS): PerfCounts {
  const counts: PerfCounts = { A: {}, B: {}, C: {} };
  for (const v of violations) counts[v.rule][v.file] = (counts[v.rule][v.file] ?? 0) + 1;
  for (const entry of allowlist) {
    const left = (counts.A[entry.file] ?? 0) - entry.count;
    if (left > 0) counts.A[entry.file] = left;
    else delete counts.A[entry.file];
  }
  return counts;
}

/** Each rule and file whose count is above its baseline, with both numbers. */
export function overBaseline(counts: PerfCounts, baseline: PerfCounts): { rule: PerfRule; file: string; count: number; allowed: number }[] {
  const over: { rule: PerfRule; file: string; count: number; allowed: number }[] = [];
  for (const rule of RULES) {
    for (const [file, count] of Object.entries(counts[rule])) {
      const allowed = baseline[rule]?.[file] ?? 0;
      if (count > allowed) over.push({ rule, file, count, allowed });
    }
  }
  return over;
}

const total = (byFile: Record<string, number>) => Object.values(byFile).reduce((sum, n) => sum + n, 0);

/** Counts with every rule present and the files sorted, so the baseline's diff shows only what moved. */
function sortedCounts(counts: PerfCounts): PerfCounts {
  const sorted: PerfCounts = { A: {}, B: {}, C: {} };
  for (const rule of RULES) {
    for (const file of Object.keys(counts[rule]).sort()) sorted[rule][file] = counts[rule][file];
  }
  return sorted;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

/**
 * `--write` as an argument, or as npm hands it on when it is typed without the
 * `--` (`npm run check:perf --write`): npm keeps the flag and sets
 * npm_config_write, warning that a later npm will stop doing so.
 */
const wantsWrite = () => process.argv.includes("--write") || process.env.npm_config_write === "true";

function main(): void {
  const root = process.cwd();
  const violations: PerfViolation[] = [];
  const scanned = new Set<string>();
  for (const tree of new Set(Object.values(RULE_ROOTS).flat())) {
    for (const abs of walk(join(root, tree))) {
      const rel = relative(root, abs).replaceAll("\\", "/");
      if (scanned.has(rel)) continue;
      scanned.add(rel);
      violations.push(...findPerfViolations(rel, readFileSync(abs, "utf8")));
    }
  }
  const counts = sortedCounts(countViolations(violations));
  const summary = RULES.map((rule) => `${rule} ${total(counts[rule])}`).join(" · ");

  if (wantsWrite()) {
    writeFileSync(join(root, BASELINE_FILE), `${JSON.stringify(counts, null, 2)}\n`);
    console.info(`Wrote ${BASELINE_FILE}: ${summary} (${scanned.size} files scanned).`);
    return;
  }

  const baseline = JSON.parse(readFileSync(join(root, BASELINE_FILE), "utf8")) as PerfCounts;
  const over = overBaseline(counts, baseline);
  if (over.length > 0) {
    console.error(`\nFAILED — ${over.length} file(s) hold more request-rule violations than the baseline allows:\n`);
    for (const { rule, file, count, allowed } of over) {
      console.error(`  [rule ${rule}] ${file}: ${count}, baseline ${allowed}`);
      for (const v of violations.filter((x) => x.rule === rule && x.file === file)) console.error(`      ${v.line}: ${v.text}`);
    }
    console.error(
      "\nFix the code, not the baseline: name the columns the screen reads (A, or allowlist a row" +
        "\nreturned whole with its reason), take today, the week anchor and the client row from the" +
        "\nroute (B), page the read in the database (C). CONVENTIONS §8 and §14."
    );
    process.exit(1);
  }
  const lower = RULES.filter((rule) => total(counts[rule]) < total(baseline[rule] ?? {}));
  console.info(`OK — ${summary} (${scanned.size} files scanned), none above the baseline.`);
  if (lower.length > 0) console.info(`Rule ${lower.join(", ")} fell below the baseline: \`npm run check:perf -- --write\` locks the gain in.`);
}

// Only run when invoked directly, so the rules above can be unit-tested
// without the test suite walking the real tree.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
