import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { TextSkeleton } from "./text-skeleton"

describe("TextSkeleton", () => {
  it("is phrasing content — legal inside a <p>, or the parser splits it", () => {
    // The HTML parser closes a <p> at the first flow element, and React 19
    // reports that as a hydration hazard. This component exists to sit inside
    // real text elements, so rendering as a span IS its contract.
    const { container } = render(
      <p>
        <TextSkeleton className="w-16" />
      </p>
    )
    expect(container.querySelector("p span[data-slot=skeleton]")).not.toBeNull()
    expect(container.querySelector("p div")).toBeNull()
  })
})
