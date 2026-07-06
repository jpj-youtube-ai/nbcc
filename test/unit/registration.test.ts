import { describe, it, expect } from "vitest";
import {
  CHARITY_NAME,
  CHARITY_SHORT_NAME,
  OSCR_NUMBER,
  OSCR_REGISTER_URL,
  REGISTRATION_LINES,
  REGISTRATION_TEXT,
  REGISTRATION_HTML,
} from "../../src/legal/registration";

// TASK-126: the single source of truth for NBCC's charity-registration statement,
// which must appear verbatim in every page footer and every donor-facing
// receipt / thank-you letter.

const LINE1 =
  "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.";
const LINE2 =
  "Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.";

describe("charity registration (TASK-126)", () => {
  it("exposes the canonical identity constants", () => {
    expect(CHARITY_NAME).toBe("Night Before Christmas Campaign");
    expect(CHARITY_SHORT_NAME).toBe("NBCC");
    expect(OSCR_NUMBER).toBe("SC047995");
    expect(OSCR_REGISTER_URL).toContain("oscr.org.uk");
    expect(OSCR_REGISTER_URL).toContain("SC047995");
  });

  it("exposes the two exact mandated lines", () => {
    expect(REGISTRATION_LINES).toEqual([LINE1, LINE2]);
  });

  it("joins the lines for plain-text letters", () => {
    expect(REGISTRATION_TEXT).toBe(`${LINE1}\n${LINE2}`);
  });

  it("renders an HTML fragment carrying both lines", () => {
    expect(REGISTRATION_HTML).toContain(LINE1);
    expect(REGISTRATION_HTML).toContain(LINE2);
    expect(REGISTRATION_HTML).toContain("<br />");
    expect(REGISTRATION_HTML).toContain('class="charity-registration"');
  });
});
