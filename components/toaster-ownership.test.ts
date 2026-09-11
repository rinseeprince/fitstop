// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * Exactly one toaster (docs/newdesignsystem.md → Toasts; CONVENTIONS §3).
 *
 * The toaster is Sonner, styled once in components/ui/sonner.tsx and mounted
 * once by the root layout. A second mount renders two toasts for one action;
 * a second import of Sonner's Toaster is a second place its look can be set;
 * an import of the retired Radix toaster or its hook is a call site that has
 * come back on the old shape. Each is a defect, not a choice.
 */
const ROOT = join(__dirname, "..")
const STYLED_TOASTER = "components/ui/sonner.tsx"
const LAYOUT = "app/layout.tsx"

const SONNER_TOASTER_IMPORT = /import\s*{[^}]*\bToaster\b[^}]*}\s*from\s*["']sonner["']/
const TOASTER_MOUNT = /<Toaster\b/g
const RETIRED = /["'](@radix-ui\/react-toast|@\/hooks\/use-toast|@\/components\/ui\/toast(er)?)["']/

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) sources(abs, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(abs)
  }
  return out
}

const files = new Map<string, string>()
for (const dir of ["app", "components", "contexts", "hooks", "lib", "services", "utils"]) {
  for (const abs of sources(join(ROOT, dir))) {
    files.set(relative(ROOT, abs).replaceAll("\\", "/"), readFileSync(abs, "utf8"))
  }
}

describe("one toaster", () => {
  it("imports Sonner's Toaster in the styled primitive and nowhere else", () => {
    const importers = [...files].filter(([, text]) => SONNER_TOASTER_IMPORT.test(text)).map(([file]) => file)
    expect(importers).toEqual([STYLED_TOASTER])
  })

  it("mounts the toaster exactly once, in the root layout", () => {
    const mounts = [...files]
      .filter(([file]) => file !== STYLED_TOASTER)
      .map(([file, text]) => [file, text.match(TOASTER_MOUNT)?.length ?? 0] as const)
      .filter(([, count]) => count > 0)
    expect(mounts).toEqual([[LAYOUT, 1]])
    expect(files.get(LAYOUT)).toMatch(/from ["']@\/components\/ui\/sonner["']/)
  })

  it("has no import of the retired Radix toaster or its hook", () => {
    const survivors = [...files].filter(([, text]) => RETIRED.test(text)).map(([file]) => file)
    expect(survivors).toEqual([])
  })
})
