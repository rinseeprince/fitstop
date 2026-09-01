import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PageLoading } from "./page-loading"

describe("PageLoading", () => {
  it("names what is loading, visibly, inside a status region", () => {
    render(<PageLoading label="Loading things…" />)
    expect(screen.getByRole("status")).toBeInTheDocument()
    // The label is the point of the spec — a bare spinner says something is
    // happening but not what. (Whether it is VISIBLE is the browser smoke's
    // half; jsdom loads no stylesheet.)
    expect(screen.getByText("Loading things…")).toBeInTheDocument()
  })
})
