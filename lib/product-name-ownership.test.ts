// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"
import { PRODUCT_NAME } from "@/lib/constants"

/**
 * The product's name is written once (docs/BETTER-AUTH-PLAN.md 2.11, D30):
 * PRODUCT_NAME in lib/constants.ts, which every screen, email and tab title
 * that names the product reads. Over every code file, the name the product
 * shipped under before is gone in any case, and the name itself is spelled
 * out nowhere but lib/constants.ts, in no spelling, so it can't drift. In
 * lower case and joined into an address (a domain, a file name, a storage
 * key, the app's scheme) it is the address, not the name, and passes.
 */
const ROOT = join(__dirname, "..")
const CONSTANTS = "lib/constants.ts"

// Every folder of code, and the root's own code files beside them. The docs
// are prose for people, and the migrations are history.
const CODE_DIRS = ["app", "components", "contexts", "emails", "hooks", "lib", "scripts", "services", "types", "utils", "__tests__"]
const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|css|csv|json|sql)$/
const ROOT_CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/

// The old name's two words, in any case, with at most one character between.
const OLD_NAME = /coach[\W_]?hub/i
// The product's name in any spelling: its letters in order, in any case, with
// at most one character between any two of them.
const ANY_SPELLING = new RegExp(PRODUCT_NAME.split("").join("[\\W_]?"), "gi")
// What joins an address's parts: "seed.<name>.test", "<name>://", "<name>:intake-panel".
const JOINER = /[./:@_-]/
const ADDRESS_PART = /[\w./:@-]/

function codeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) codeFiles(abs, out)
    else if (CODE_FILE.test(entry)) out.push(abs)
  }
  return out
}

const files = new Map<string, string>()
for (const abs of [
  ...CODE_DIRS.flatMap((dir) => codeFiles(join(ROOT, dir))),
  ...readdirSync(ROOT)
    .filter((entry) => ROOT_CODE_FILE.test(entry))
    .map((entry) => join(ROOT, entry)),
]) {
  files.set(relative(ROOT, abs).replaceAll("\\", "/"), readFileSync(abs, "utf8"))
}

/** The name in lower case, joined on either side to more of an address. */
function isAddress(text: string, found: string, at: number): boolean {
  if (found !== PRODUCT_NAME.toLowerCase()) return false
  const end = at + found.length
  const joinedBefore = JOINER.test(text[at - 1] ?? "") && ADDRESS_PART.test(text[at - 2] ?? "")
  const joinedAfter = JOINER.test(text[end] ?? "") && ADDRESS_PART.test(text[end + 1] ?? "")
  return joinedBefore || joinedAfter
}

/** Every spelling of the name in `text` that is not an address. */
function namesIn(text: string): string[] {
  return [...text.matchAll(ANY_SPELLING)]
    .filter((match) => !isAddress(text, match[0], match.index))
    .map((match) => match[0])
}

// Planted text for the matchers' own test, built from parts so this file
// passes its own scan: the old name's two words, and the name split where
// its second word starts.
const oldName = (between: string) => ["Coach", "Hub"].join(between)
const lower = PRODUCT_NAME.toLowerCase()
const [firstWord, secondWord] = [PRODUCT_NAME.slice(0, 6), PRODUCT_NAME.slice(6)]
const SecondWord = secondWord.charAt(0).toUpperCase() + secondWord.slice(1)

describe("the product's name, written once", () => {
  it("leaves no trace of the old name, in any case, in any code file", () => {
    const survivors = [...files].filter(([, text]) => OLD_NAME.test(text)).map(([file]) => file)
    expect(survivors).toEqual([])
  })

  it("is spelled out once, as PRODUCT_NAME in lib/constants.ts, in no other file and no other spelling", () => {
    const spelled = [...files].flatMap(([file, text]) => namesIn(text).map((found) => `${file}: ${found}`))
    expect(spelled).toEqual([`${CONSTANTS}: ${PRODUCT_NAME}`])
    expect(files.get(CONSTANTS)).toContain(`export const PRODUCT_NAME = "${PRODUCT_NAME}";`)
  })

  it("recognises what it forbids, and lets an address pass", () => {
    for (const text of [oldName(""), oldName("-").toLowerCase(), oldName(" ").toUpperCase(), `${oldName("").toLowerCase()}:intake-panel`]) {
      expect(OLD_NAME.test(text), text).toBe(true)
    }
    for (const text of [
      `<span>${PRODUCT_NAME}</span>`,
      `${firstWord}${SecondWord}`,
      `${firstWord} ${SecondWord}`,
      PRODUCT_NAME.toUpperCase(),
      `<span>${lower}</span>`,
      `Welcome to ${lower}. Sign in below.`,
      `${PRODUCT_NAME}.com`,
    ]) {
      expect(namesIn(text), text).toHaveLength(1)
    }
    for (const text of [`seed.${lower}.test`, `${lower}://`, `${lower}:intake-panel`, `${lower}-builder-redesign.html`, `hello@${lower}.com`]) {
      expect(namesIn(text), text).toEqual([])
    }
  })

  it("reads the code it guards: the files that show the name are in the scan", () => {
    for (const file of ["app/layout.tsx", "app/login/page.tsx", "emails/invitation-email.tsx", "services/email-service.ts", "proxy.ts"]) {
      expect(files.has(file), file).toBe(true)
    }
  })
})
