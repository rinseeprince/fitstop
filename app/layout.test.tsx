import { describe, it, expect, vi } from "vitest"

// Next compiles its font loaders away at build; under vitest they are bare calls.
vi.mock("next/font/google", () => ({
  Instrument_Sans: () => ({ className: "" }),
  JetBrains_Mono: () => ({ variable: "" }),
}))

import { metadata } from "./layout"
import { PRODUCT_NAME } from "@/lib/constants"

describe("the root layout", () => {
  it("titles the browser tab with the product's name", () => {
    expect(metadata.title).toBe(`${PRODUCT_NAME} - Client Management Platform`)
  })
})
