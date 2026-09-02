import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * The invariant, stated precisely because the scan below and the invariant have
 * to agree:
 *
 *   ONE writer for UPDATES to clients.bmr / clients.tdee —
 *   services/client-energy-service.ts.
 *
 *   createClient's INSERT sets the pair once at row birth, through the same
 *   pure calculator (services/client-energy-calc.ts), and is DELIBERATELY
 *   outside this scan.
 *
 * Read that twice before changing either half. Widening the scan to inserts
 * breaks the build for a site that is correct; narrowing the invariant to "one
 * writer, full stop" re-opens the hole this closed.
 *
 * Why a source scan rather than a unit test: the failure mode is a NEW writer
 * being added months from now. Six existed before this was centralized, three
 * of them writing only half the pair, and no unit test could have noticed the
 * seventh arriving. Same shape as scripts/check-labels.ts.
 */

const ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["app", "services", "hooks", "lib", "utils", "components"];
const OWNER = join("services", "client-energy-service.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Detect a `clients` UPDATE whose payload carries bmr or tdee.
 *
 * Two shapes, and the second is why this is not a one-line regex: a payload
 * built in a variable (`.update(payload)`) hides its keys from any scan that
 * only reads the update statement. The owner itself is written that way, which
 * is how this detector's own blind spot was found — so an identifier argument
 * is resolved back to where it is declared or mutated.
 */
function findsEnergyUpdate(source: string): boolean {
  const statements = /from\(\s*["'`]clients["'`]\s*\)([\s\S]{0,600}?);/g;
  let match: RegExpExecArray | null;

  while ((match = statements.exec(source)) !== null) {
    const statement = match[1];
    const update = /\.update\(\s*([\s\S]*?)\s*\)\s*(?:\.|;|$)/.exec(statement);
    if (!update) continue;
    const argument = update[1];

    // Shape 1 — inline object literal: .update({ bmr, tdee })
    if (argument.startsWith("{")) {
      if (/\b(bmr|tdee)\b/.test(argument)) return true;
      continue;
    }

    // Shape 2 — identifier: .update(payload). Resolve it.
    const identifier = argument.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) continue;
    const assignsProperty = new RegExp(
      `\\b${identifier}\\.(bmr|tdee)\\b\\s*=`
    );
    const declaresWithKey = new RegExp(
      `\\b${identifier}\\b[^=;]*=\\s*\\{[^}]*\\b(bmr|tdee)\\b`
    );
    if (assignsProperty.test(source) || declaresWithKey.test(source)) {
      return true;
    }
  }

  return false;
}

describe("clients.bmr / clients.tdee have exactly one UPDATE writer", () => {
  const offenders: string[] = [];

  for (const dir of SCANNED_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const relative = file.slice(ROOT.length + 1);
      if (relative === OWNER) continue;
      if (findsEnergyUpdate(readFileSync(file, "utf8"))) {
        offenders.push(relative);
      }
    }
  }

  it("finds no writer outside services/client-energy-service.ts", () => {
    expect(offenders).toEqual([]);
  });

  it("detects an inline-literal writer", () => {
    // Guards against the detector silently matching nothing — an ownership test
    // that cannot fail is worse than no test, because it reads as proof.
    expect(
      findsEnergyUpdate(`
        await supabaseAdmin
          .from("clients")
          .update({ bmr, tdee })
          .eq("id", clientId);
      `)
    ).toBe(true);
  });

  it("detects a writer that hides the pair in a variable payload", () => {
    // The shape the first version of this detector missed. A future writer
    // doing exactly this would otherwise pass the ownership check.
    expect(
      findsEnergyUpdate(`
        const patch: Record<string, unknown> = {};
        patch.bmr = 1800;
        await supabaseAdmin.from("clients").update(patch).eq("id", clientId);
      `)
    ).toBe(true);

    expect(
      findsEnergyUpdate(`
        const patch = { bmr: 1800, tdee: 2160 };
        await supabaseAdmin.from("clients").update(patch).eq("id", clientId);
      `)
    ).toBe(true);
  });

  it("does not flag an unrelated clients update", () => {
    expect(
      findsEnergyUpdate(`
        await supabaseAdmin
          .from("clients")
          .update({ height: 182 })
          .eq("id", clientId);
      `)
    ).toBe(false);

    expect(
      findsEnergyUpdate(`
        const profileUpdate: Record<string, unknown> = {};
        profileUpdate.height = 182;
        await supabaseAdmin.from("clients").update(profileUpdate).eq("id", id);
      `)
    ).toBe(false);
  });

  it("the owner itself contains the writer the scan exempts", () => {
    // If the owner ever stops writing the pair, this suite would pass while
    // nothing writes it at all.
    const owner = readFileSync(join(ROOT, OWNER), "utf8");
    expect(findsEnergyUpdate(owner)).toBe(true);
  });
});
