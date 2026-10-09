import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import MarketingLayout from "./layout"
import { PRODUCT_NAME } from "@/lib/constants"

describe("the marketing pages' frame", () => {
  it("names the product in the navbar and the footer", () => {
    render(
      <MarketingLayout>
        <p>Page</p>
      </MarketingLayout>
    )
    expect(screen.getByRole("link", { name: PRODUCT_NAME })).toHaveAttribute("href", "/")
    expect(screen.getByText(`© ${new Date().getFullYear()} ${PRODUCT_NAME}. All rights reserved.`)).toBeInTheDocument()
  })
})
