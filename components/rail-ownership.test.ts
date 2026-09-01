// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * Each shell owns its rail (ARCHITECTURE → "Coach route group").
 *
 * The rail is not a global: it is mounted by the shell of the surface it
 * belongs to, beside the offset that shell hardcodes for it, so geometry and
 * rail cannot disagree and no component has to work out which surface it is
 * on. A rail mounted anywhere else — a layout, a page, a second shell — is
 * either a double rail or a rail that has started deciding things again.
 */
const ROOT = join(__dirname, "..")

const SHELLS: Record<string, "PersistentSidebar" | "CollapsedIconStrip"> = {
  "components/app-layout.tsx": "PersistentSidebar",
  "components/clients/roster/roster-shell.tsx": "CollapsedIconStrip",
  "components/clients/client-detail-layout.tsx": "CollapsedIconStrip",
  "components/programs/programs-shell.tsx": "CollapsedIconStrip",
}

const MOUNT = /<(PersistentSidebar|CollapsedIconStrip)\b/g

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) sources(abs, out)
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(abs)
  }
  return out
}

const mounts = new Map<string, string[]>()
for (const abs of [...sources(join(ROOT, "app")), ...sources(join(ROOT, "components"))]) {
  const found = [...readFileSync(abs, "utf8").matchAll(MOUNT)].map((m) => m[1])
  if (found.length > 0) mounts.set(relative(ROOT, abs).replaceAll("\\", "/"), found)
}

describe("each shell owns its rail", () => {
  it("mounts a rail in the four shells and nowhere else", () => {
    expect([...mounts.keys()].sort()).toEqual(Object.keys(SHELLS).sort())
  })

  it("mounts exactly one rail per shell, the variant its offset is drawn for", () => {
    for (const [shell, rail] of Object.entries(SHELLS)) {
      expect(mounts.get(shell), shell).toEqual([rail])
    }
  })
})
