import { escapeHtml } from "../events/render";
import { IMPACT_FOOTNOTE, exampleExactly, giveFormExamples, meterImpactLine, type ImpactExample } from "../impact/examples";
import { isQuietFundraiser } from "./touch-rules";
import type { FundraiserRecord } from "./model";

// What gifts could do, on a fundraiser's, an event's or a team's page (Jaimie, 2026-10-03): the
// pieces src/fundraising/render.ts puts in place. Kept here so the page's own renderer only places
// them. Pure: no database, no clock. Staff's words are escaped on the way out.
//
//   - under each give amount that has an example, its words, small, inside the amount's label (so
//     a screen reader hears "£5 could help put ..." as the choice);
//   - under your own amount, a live region assets/js/fundraiser.js fills in as they type (always
//     there, empty until it has something, and named by the box's aria-describedby): the example
//     with the largest amount at or below it, from the form's data-could, nothing below the smallest
//     or the page's minimum;
//   - under the meter, how many Red Bags Full of Joy the total could fill (meterImpactLine);
//   - the footnote, shown once wherever any of it shows: under the give amounts when they show
//     examples, else under the meter. When both show, the meter's copy is data-nojs: the give form
//     is hidden without JavaScript, so that copy stands in for it, and the script that shows the
//     form hides it (as it does every data-nojs line).
//
// A page in memory of someone shows none of it: the route passes no list for those (showsImpact).

export interface ImpactParts {
  /** The words under one preset amount, or "". */
  preset: (pence: number) => string;
  /** The give form's data-could attribute (with its leading space), or "". */
  formAttr: string;
  /** The own amount box's aria-describedby (with its leading space), or "". */
  ownAttr: string;
  /** Under your own amount: the line the script fills in, and the footnote. */
  afterOwn: string;
  /** Under the meter: its line, and the footnote when the give form shows no examples. */
  afterMeter: string;
}

/** No examples at all: an in memory page, or a page whose list is empty. */
export const NONE: ImpactParts = { preset: () => "", formAttr: "", ownAttr: "", afterOwn: "", afterMeter: "" };

const OWN_ID = "frOwnCould";
const footnote = (extra = "") => `<p class="fr-could-note"${extra}>${escapeHtml(IMPACT_FOOTNOTE)}</p>`;

export function impactParts(impact: readonly ImpactExample[] | undefined, raisedPence: number): ImpactParts {
  if (!impact || impact.length === 0) return NONE;
  const give = giveFormExamples(impact);
  const meterLine = meterImpactLine(raisedPence, impact);
  if (!give.length && !meterLine) return NONE;
  const data = JSON.stringify(give.map((e) => ({ p: e.amountPence, w: e.wording })));
  return {
    preset: (pence) => {
      const e = exampleExactly(pence, impact);
      return e ? ` <span class="fr-amount__could">${escapeHtml(e.wording)}</span>` : "";
    },
    formAttr: give.length ? ` data-could="${escapeHtml(data)}"` : "",
    ownAttr: give.length ? ` aria-describedby="${OWN_ID}"` : "",
    afterOwn: give.length ? `<p class="fr-could fr-own__could" id="${OWN_ID}" data-own-could aria-live="polite"></p>` + footnote() : "",
    afterMeter: meterLine ? `<p class="fr-meter__could">${escapeHtml(meterLine)}</p>` + footnote(give.length ? " data-nojs" : "") : "",
  };
}

/**
 * Does this page show what gifts could do? Never on a page in memory of someone: those pages are
 * quiet. It asks isQuietFundraiser (src/fundraising/touch-rules.ts), the one place that recognises
 * one: by its in_memory flag (isInMemory), or a category that mentions memory. The in memory page's
 * own renderer (./memory-render.ts) draws the give form without any of it either way.
 */
export function showsImpact(f: Pick<FundraiserRecord, "kind"> & { inMemory?: boolean | null }): boolean {
  return !isQuietFundraiser(f);
}
