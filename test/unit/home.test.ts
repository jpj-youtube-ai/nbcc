import { describe, it, expect } from "vitest";
import { renderHomePage, CHARITY_NAME } from "../../src/routes/home";

describe("renderHomePage", () => {
  it("renders the charity name as the page heading", () => {
    const html = renderHomePage("staging");
    expect(html).toContain(`<h1>${CHARITY_NAME}</h1>`);
  });

  it("shows the environment so staging and prod are distinguishable", () => {
    expect(renderHomePage("staging")).toContain("staging");
    expect(renderHomePage("production")).toContain("production");
  });
});
