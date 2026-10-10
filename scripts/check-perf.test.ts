import { describe, expect, it } from "vitest";

import { countViolations, findPerfViolations, overBaseline, type PerfCounts } from "./check-perf";

const rulesIn = (file: string, content: string) => findPerfViolations(file, content).map((v) => [v.rule, v.line]);

describe("rule A: a read returns what the screen renders", () => {
  it("flags select(\"*\") in its three spellings, with its line, in a service and in a route", () => {
    const content = [
      `const a = await supabaseAdmin.from("clients").select("*").eq("id", id);`,
      `const b = await supabaseAdmin.from("notes").select('*');`,
      "const c = await supabaseAdmin.from(\"plans\").select(`*, sessions(id)`);",
    ].join("\n");
    expect(rulesIn("services/x-service.ts", content)).toEqual([["A", 1], ["A", 2], ["A", 3]]);
    expect(rulesIn("app/api/x/route.ts", content)).toEqual([["A", 1], ["A", 2], ["A", 3]]);
  });

  it("flags a select list that opens on the next line, and one held in a constant", () => {
    const content = [
      "const q = supabaseAdmin.from(\"sessions\").select(",
      "  `*, exercises(id)`",
      ");",
      "export const ROW_COLUMNS =",
      '  "*, embed(id)";',
    ].join("\n");
    expect(rulesIn("services/x-service.ts", content)).toEqual([["A", 1], ["A", 4]]);
  });

  it("passes named columns, an embedded child's whole row, a comment, and code outside its trees", () => {
    const named = `supabaseAdmin.from("clients").select("id, name, coach_id").eq("id", id);`;
    const embed = `supabaseAdmin.from("events").select("id, log:session_logs(*)");`;
    const comment = `// that one is select("*"), and so is /* select('*') */ this`;
    expect(rulesIn("services/x-service.ts", [named, embed, comment].join("\n"))).toEqual([]);
    expect(rulesIn("lib/x.ts", `supabaseAdmin.from("clients").select("*");`)).toEqual([]);
  });

  it("lets the allowlist sanction a file's whole-row selects, and no more of them", () => {
    const violations = findPerfViolations("services/client-service.ts", `select("*");\nselect("*");`);
    const allowOne = [{ file: "services/client-service.ts", count: 1, reason: "returned whole" }];
    expect(countViolations(violations, allowOne).A).toEqual({ "services/client-service.ts": 1 });
    expect(countViolations(violations, [{ ...allowOne[0], count: 2 }]).A).toEqual({});
  });
});

describe("rule B: a service never resolves the context of a client it was handed", () => {
  it("flags each resolver a service imports, renamed or in a multi-line import", () => {
    const content = [
      `import { getClientTodayString } from "@/services/today-service";`,
      "import {",
      "  getClientWeekAnchor as anchorOf,",
      "  somethingElse,",
      `} from "./check-in-week-service";`,
      `import { getClientById } from "@/services/client-service";`,
    ].join("\n");
    expect(rulesIn("services/x-service.ts", content)).toEqual([["B", 1], ["B", 2], ["B", 6]]);
  });

  it("passes a resolver's own module, the route layer, and a mention in a comment", () => {
    const own = `import { getCoachTodayString } from "@/services/today-service";`;
    expect(rulesIn("services/today-service.ts", own)).toEqual([]);
    expect(rulesIn("app/api/x/route.ts", own)).toEqual([]);
    expect(rulesIn("lib/require-coach-auth.ts", `import { getClientById } from "@/services/client-service";`)).toEqual([]);
    expect(rulesIn("services/x-service.ts", `// import { getClientById } from "@/services/client-service";`)).toEqual([]);
  });
});

describe("rule C: what can exceed a page is paged in the database", () => {
  it("flags a read sliced by offset or from, and fetchAllPages, in a route", () => {
    const content = [
      "const rows = all.slice(offset, offset + limit);",
      "const page = all.slice( from, to);",
      "const every = await fetchAllPages((a, b) => query.range(a, b));",
    ].join("\n");
    expect(rulesIn("app/api/x/route.ts", content)).toEqual([["C", 1], ["C", 2], ["C", 3]]);
  });

  it("passes other slices, a URL's //, and a service", () => {
    const content = [`const day = date.slice(0, 10);`, `const url = "https://x.test/a"; const page = all.slice(offset);`].join("\n");
    expect(rulesIn("app/api/x/route.ts", content)).toEqual([["C", 2]]);
    expect(rulesIn("services/x-service.ts", "all.slice(offset, offset + limit);")).toEqual([]);
  });
});

describe("the ratchet", () => {
  const baseline: PerfCounts = { A: { "services/a.ts": 2 }, B: {}, C: { "app/api/c/route.ts": 1 } };

  it("holds a file at its baseline and a file the baseline does not name at none", () => {
    const counts: PerfCounts = { A: { "services/a.ts": 3, "services/new.ts": 1 }, B: {}, C: { "app/api/c/route.ts": 1 } };
    expect(overBaseline(counts, baseline)).toEqual([
      { rule: "A", file: "services/a.ts", count: 3, allowed: 2 },
      { rule: "A", file: "services/new.ts", count: 1, allowed: 0 },
    ]);
  });

  it("passes the baseline itself and anything below it", () => {
    expect(overBaseline(baseline, baseline)).toEqual([]);
    expect(overBaseline({ A: { "services/a.ts": 1 }, B: {}, C: {} }, baseline)).toEqual([]);
  });
});
