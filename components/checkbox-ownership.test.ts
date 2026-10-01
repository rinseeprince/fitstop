// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * One look for the tick (docs/newdesignsystem.md → Checkbox; → Anti-patterns:
 * "Never correct a ui/ primitive at the call site").
 *
 * The Checkbox carries its Teal-Summit look in components/ui/checkbox.tsx. A
 * call site passes a size — `size-5` on the client's ticks — and nothing else
 * of the look: a border, a fill or a ring pasted on beside it is a second
 * place the tick is styled, which is how the workout tracker came to correct
 * the un-migrated default twice and the habits page nearly made it three.
 */
const ROOT = join(__dirname, "..")
const PRIMITIVE = "components/ui/checkbox.tsx"
const IMPORT = /from\s*["']@\/components\/ui\/checkbox["']/
const ELEMENT = /<Checkbox\b([\s\S]*?)\/>/g
const CLASS_NAME = /\bclassName=(?:"([^"]*)"|'([^']*)'|\{)/
/** The one thing a call site may set: the box's size. */
const SIZE = /^size-\d+(\.\d+)?$/

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) sources(abs, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(abs)
  }
  return out
}

const callSites = ["app", "components"]
  .flatMap((dir) => sources(join(ROOT, dir)))
  .map((abs) => ({ file: relative(ROOT, abs).replaceAll("\\", "/"), text: readFileSync(abs, "utf8") }))
  .filter(({ file, text }) => file !== PRIMITIVE && IMPORT.test(text))

/** Each class a call site gives its Checkbox that is not a size, or the whole prop when it is not a plain string. */
function restyling(text: string): string[] {
  return [...text.matchAll(ELEMENT)].flatMap(([, props]) => {
    const match = CLASS_NAME.exec(props)
    if (!match) return []
    const classes = match[1] ?? match[2]
    if (classes === undefined) return ["className={…}"]
    return classes.split(/\s+/).filter((cls) => cls !== "" && !SIZE.test(cls))
  })
}

describe("the tick is styled once", () => {
  it("scans every call site — the guard is worthless if the glob is empty", () => {
    expect(callSites.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        "components/client-portal/habits/habit-entry-row.tsx",
        "components/client-portal/training/set-row.tsx",
        "components/client-portal/training/exercise-tracker-block.tsx",
      ])
    )
  })

  it("gives no call site's Checkbox anything of the look: a size, or nothing", () => {
    const offenders = callSites
      .map(({ file, text }) => [file, restyling(text)] as const)
      .filter(([, classes]) => classes.length > 0)
    expect(offenders).toEqual([])
  })

  it("recognises what it forbids", () => {
    expect(restyling('<Checkbox checked className="size-5" />')).toEqual([])
    expect(restyling("<Checkbox checked onCheckedChange={(c) => set(c)} />")).toEqual([])
    expect(restyling('<Checkbox className="size-5 border-[#93b0b4] data-[state=checked]:bg-[#0d9488]" />')).toEqual([
      "border-[#93b0b4]",
      "data-[state=checked]:bg-[#0d9488]",
    ])
    expect(restyling("<Checkbox className={cn(\"size-5\", ring)} />")).toEqual(["className={…}"])
  })
})
